package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func TestGrammarAdmissionRegExpQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed; review the native regexp lab gap")
	}
}

// This is a pending lab boundary, not a derivation supplied by the compiler.
// Printable ASCII PatternCharacters, their simple quantifiers and valid
// distinct flags qualify. Each ?, * or + needs an atom; a following ? makes
// it lazy. Groups, classes, escapes, anchors, dots and non-ASCII stay outside
// this family. Literal punctuation such as '=' and '>' is not an operator.
func grammarPlainRegExpLiteral(literal string) bool {
	if !strings.HasPrefix(literal, "/") {
		return false
	}
	slash := strings.LastIndex(literal, "/")
	if slash <= 1 {
		return false
	}
	atom, quantified := false, false
	for _, c := range literal[1:slash] {
		if c == '?' || c == '*' || c == '+' {
			if atom {
				atom, quantified = false, true
			} else if c == '?' && quantified {
				quantified = false
			} else {
				return false
			}
			continue
		}
		if c < ' ' || c > '~' || strings.ContainsRune("^$\\.()[]{}|/", c) {
			return false
		}
		atom, quantified = true, false
	}
	flags := map[rune]bool{}
	for _, c := range literal[slash+1:] {
		if !strings.ContainsRune("dgimsuvy", c) || flags[c] {
			return false
		}
		flags[c] = true
	}
	return !(strings.Contains(literal[slash+1:], "u") && strings.Contains(literal[slash+1:], "v"))
}

// AST spans identify literal boundaries only. Their contents are constrained
// independently above, and the lab still reports its missing derivation.
// Replacing just those primaries must leave no independent grammar gap.
func grammarSimpleRegExpLabGap(source string) bool {
	if !strings.Contains(source, "/") {
		return false
	}
	file := parseAs(parseKinds[0], source)
	if HasError(file.Diagnostics()) {
		return false
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
			if start < 0 || end > len(source) || start >= end || !grammarPlainRegExpLiteral(source[start:end]) {
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
		return false
	}
	lab, err := admissionLab()
	if err != nil {
		return false
	}
	mode := grammarParseMode{prose: true, names: true}
	if lab.read(lab.g, grammarLexSource(source), mode).count != 0 {
		return false
	}
	var normalized strings.Builder
	at := 0
	for _, s := range spans {
		if s.start < at {
			return false
		}
		normalized.WriteString(source[at:s.start])
		normalized.WriteString("__regexp")
		at = s.end
	}
	normalized.WriteString(source[at:])
	return lab.read(lab.g, grammarLexSource(normalized.String()), mode).count != 0
}

var grammarRegExpSources = []string{
	"n = / 2 /\n2\n;",
	"n = / => 2 /\n2\n;",
	"n = / ?? 2 /\n2\n;",
	"const r = /a?/;",
	"const r = /a*/;",
	"const r = /a+/;",
	"const r = /a??/;",
	"const r = /a*?/;",
	"const r = /a+?/;",
	"const r = /a?b*/;",
	"const r = /a*b+c?d/;",
	"const r = /a*?/u;",
	"const r = /a+?/v;",
	"const r = /a?b/;",
	"const r = /a=>b/;",
	"const r = /a<=>b/;",
	"const r = /a!%&,:;@#~-b/;",
	"const r = /a=>b/u;",
	"const r = /a=>b/v;",
	"const r = /a/;",
	"const r = /abc123/gi;",
	"const r = /a b/m;",
	"const r = /word/u;",
	"const r = /abc/gy;",
	"const r = [/a/, /b/];",
	"function f() { return /a/; }",
	"const b = /a/.test(\"a\");",
	"const r = ok ? /a/ : /b/;",
}

func TestGrammarAdmissionRegExpKeys(t *testing.T) {
	for _, source := range grammarRegExpSources {
		if got := grammarAdmissionForm(source); got != "admission:native-regexp-literal" {
			t.Errorf("plain regexp lost its bounded lab key: %q: %s", got, source)
		}
	}
	for _, source := range []string{
		"const n = 8 / 2 / 2;", "const text = \"/a/\";",
		"// /a/\nconst n = 1;", "const r = /[ab]/;",
		"const r = /a/gg;", "const r = /a/z;", "const r = /a/uv;",
		"const r = /a.b/;", "const r = /a|b/;", "const r = /a^b/;",
		"const r = /a$b/;", "const r = /a{2}/;",
		"const r = /?a/;", "const r = /*a/;", "const r = /+a/;",
		"const r = /a**/;", "const r = /a*+/;", "const r = /a???/;",
		"const r = /é/;", "const r = /a\\nb/;", "const r = /a\tb/;",
		"const r = /a\nb/;", "const r = /unterminated;", "const r = /a/; const b = x is 1 + 1;",
	} {
		if grammarSimpleRegExpLabGap(source) {
			t.Errorf("separate form entered plain regexp lab family: %s", source)
		}
	}
	const independent = "const r = /a/; const b = x is 1 + 1;"
	if got := grammarAdmissionForm(independent); got != "admission:is-operand-precedence" {
		t.Errorf("regexp normalization hid an independent gap: %q", got)
	}
}

func TestGrammarAdmissionRegExpRegression(t *testing.T) {
	TestGrammarAdmissionRegExpQuoted(t)
	w := NewWorkspace(t)
	for _, source := range grammarRegExpSources {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("recorded native regexp lab boundary changed: %s", source)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	t.Run("lazy-quantifier-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-regexp-literal\n02B1"))
		if source != "n = / ?? 2 /\n2\n;" {
			t.Fatalf("keyed quantifier mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})

	t.Run("literal-punctuation-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-regexp-literal\n02B00"))
		if source != "n = / => 2 /\n2\n;" {
			t.Fatalf("keyed regexp mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})

	t.Run("raw-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-division\n08008000Y0000"))
		if source != grammarRegExpSources[0] {
			t.Fatalf("keyed division mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
}
