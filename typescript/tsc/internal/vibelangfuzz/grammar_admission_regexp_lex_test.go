package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func grammarRequireRegExpNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		if os.Getenv("VIBELANG_FUZZ_REQUIRE") == "1" {
			t.Fatal("native RegExp lexical checks require Node.js")
		}
		t.Skip("native RegExp lexical checks require Node.js")
	}
}

var grammarRegExpSyntaxCache struct {
	sync.Mutex
	values map[string]bool
}

// Check one literal's lexical envelope independently of the compiler AST.
// vm.Script then checks its ECMAScript pattern syntax without executing it.
func grammarRegExpLiteralSyntax(literal string) bool {
	if len(literal) < 3 || literal[0] != '/' || strings.ContainsAny(literal, "\n\r\u2028\u2029") {
		return false
	}
	escaped, inClass, close := false, false, -1
	for i := 1; i < len(literal); i++ {
		ch := literal[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == '[' {
			inClass = true
		}
		if ch == ']' {
			inClass = false
		}
		if ch == '/' && !inClass {
			close = i
			break
		}
	}
	if close <= 1 || close != strings.LastIndex(literal, "/") {
		return false
	}
	flags := map[rune]bool{}
	for _, ch := range literal[close+1:] {
		if !strings.ContainsRune("dgimsuvy", ch) || flags[ch] {
			return false
		}
		flags[ch] = true
	}
	if flags['u'] && flags['v'] {
		return false
	}
	grammarRegExpSyntaxCache.Lock()
	valid, known := grammarRegExpSyntaxCache.values[literal]
	grammarRegExpSyntaxCache.Unlock()
	if known {
		return valid
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return false
	}
	encoded, _ := json.Marshal(literal)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	const script = "const {Script}=require(\"node:vm\");const {readFileSync}=require(\"node:fs\");let valid=1;try{new Script(\"(\"+JSON.parse(readFileSync(0,\"utf8\"))+\"\\n)\")}catch(error){if(!(error instanceof SyntaxError))throw error;valid=0}process.stdout.write(String(valid))"
	cmd := exec.CommandContext(ctx, node, "--input-type=commonjs", "-e", script)
	cmd.Stdin = strings.NewReader(string(encoded))
	output, err := cmd.Output()
	if err != nil {
		panic("native RegExp syntax validator failed: " + err.Error())
	}
	switch string(output) {
	case "0":
		valid = false
	case "1":
		valid = true
	default:
		panic("native RegExp syntax validator returned an invalid response")
	}
	grammarRegExpSyntaxCache.Lock()
	if len(grammarRegExpSyntaxCache.values) >= 512 {
		grammarRegExpSyntaxCache.values = nil
	}
	if grammarRegExpSyntaxCache.values == nil {
		grammarRegExpSyntaxCache.values = map[string]bool{}
	}
	grammarRegExpSyntaxCache.values[literal] = valid
	grammarRegExpSyntaxCache.Unlock()
	return valid
}

// AST nodes supply candidate spans only. Independent lexical validation gives
// each span the RegularExpressionLiteral category, never IdentifierReference.
// The caller must still derive the whole program with those literal tokens.
func grammarValidatedRegExpTokens(source string) ([]grammarToken, bool) {
	if !strings.Contains(source, "/") {
		return nil, false
	}
	file := parseAs(parseKinds[0], source)
	if HasError(file.Diagnostics()) {
		return nil, false
	}
	type span struct{ start, end int }
	var spans []span
	unsupported := false
	var visit func(*ast.Node)
	visit = func(n *ast.Node) {
		if n == nil {
			return
		}
		if n.Kind == ast.KindRegularExpressionLiteral {
			start, end := scanner.SkipTrivia(source, n.Pos()), n.End()
			if start < 0 || end > len(source) || start >= end || !grammarRegExpLiteralSyntax(source[start:end]) {
				unsupported = true
			} else {
				spans = append(spans, span{start, end})
			}
			return
		}
		n.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
	}
	visit(file.AsNode())
	if unsupported || len(spans) == 0 {
		return nil, false
	}
	marker := "__grammar_regexp_literal__"
	for strings.Contains(source, marker) {
		marker += "_"
	}
	var text strings.Builder
	at := 0
	for _, s := range spans {
		if s.start < at {
			return nil, false
		}
		text.WriteString(source[at:s.start])
		text.WriteString(" " + marker + " ")
		at = s.end
	}
	text.WriteString(source[at:])
	tokens := grammarLexSource(text.String())
	for i := range tokens {
		if tokens[i].kind == 'w' && tokens[i].text == marker {
			tokens[i].kind = 'x'
			tokens[i].text = "RegularExpressionLiteral"
		}
	}
	return tokens, true
}

func TestGrammarAdmissionRegExpLexing(t *testing.T) {
	TestGrammarAdmissionRegExpQuoted(t)
	grammarRequireRegExpNode(t)
	for _, source := range []string{
		"n = / |> 2 /\n2\n;", "const r = /a|b/;", "const r = /(a|b)+/;",
		"const r = /[ab]/;", "const r = /^a$/m;",
	} {
		if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
			t.Errorf("valid native RegExp still has no derivation: %s: %s", source, detail)
		}
	}
}

func TestGrammarAdmissionRegExpTokenCategory(t *testing.T) {
	TestGrammarAdmissionRegExpQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, tc := range []struct {
		source string
		want   bool
	}{
		{"const r = PLACEHOLDER;", true},
		{"type T = PLACEHOLDER;", false},
		{"const PLACEHOLDER = 1;", false},
		{"const r = { PLACEHOLDER: 1 };", false},
		{"const b = x is PLACEHOLDER;", true},
	} {
		tokens := grammarLexSource(tc.source)
		for i := range tokens {
			if tokens[i].text == "PLACEHOLDER" {
				tokens[i].kind = 'x'
				tokens[i].text = "RegularExpressionLiteral"
			}
		}
		if got := lab.read(lab.g, tokens, mode).count != 0; got != tc.want {
			t.Errorf("literal category for %s: derive=%v,want %v", tc.source, got, tc.want)
		}
	}
}
