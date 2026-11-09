package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const fiberKeywordTarget = "FuzzFiberKeywordEscapes"

func TestFiberKeywordEscapesQuoted(t *testing.T) { fiberKeywordChapter(t) }
func fiberKeywordChapter(t testing.TB) {
	t.Helper()
	for _, quote := range []string{
		"ForkExpression = [+Effect] \"fork\" ForkOperand",
		"JoinExpression = [+Effect] \"join\" ForkOperand",
	} {
		if !strings.Contains(SpecText("900-appendices.md"), quote) {
			t.Fatalf("Appendix A no longer says %q", quote)
		}
	}
	quote := "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}

// Compare literal fiber keywords with native await's escape diagnostics.
// Plain identifiers and property names retain their TypeScript reading.
func FuzzFiberKeywordEscapes(f *testing.F) {
	startShortBudget(f)
	fiberKeywordChapter(f)
	keys := []string{"fork", "fork-in", "fork-scoped", "fork-detached", "join", "binding-fork", "binding-join", "call-fork", "call-join", "property-fork", "property-join"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 1, 3, 16, 19, 64, 128, 255} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		word := "fork"
		if strings.Contains(key, "join") {
			word = "join"
		}
		escape := func(word string) string {
			i := int(mode) % len(word)
			escaped := fmt.Sprintf("\\u%04x", word[i])
			if mode&16 != 0 {
				escaped = fmt.Sprintf("\\u{%x}", word[i])
			}
			return word[:i] + escaped + word[i+1:]
		}
		escaped := escape(word)
		source := ""
		twin := ""
		ordinary := true
		switch {
		case strings.HasPrefix(key, "binding-"):
			source = "const " + escaped + "=1"
		case strings.HasPrefix(key, "call-"):
			source = "function f(" + escaped + ":(n:number)=>number){return " + escaped + "(1)}"
		case strings.HasPrefix(key, "property-"):
			source = "const o={" + escaped + "(){return 1}};o." + escaped + "()"
		default:
			ordinary = false
			suffix := map[string]string{"fork-in": ".in(scope)", "fork-scoped": ".scoped", "fork-detached": ".detached"}[key]
			trivia := []string{" ", " /* operand */ ", "\n", " /*\noperand\n*/ "}[int(mode>>5)%4]
			source = "effect function f(e:any,scope:any){return " + escaped + suffix + trivia + "e}"
			twin = "async function f(e:any){return " + escape("await") + trivia + "e}"
		}
		if twin == "" {
			twin = source
		}
		ext := "vibe"
		kind := core.ScriptKindTS
		if mode&64 != 0 {
			ext = "vibex"
			kind = core.ScriptKindTSX
		}
		parse := func(name, source string) []int32 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name), VibeLangDoAsFunction: mode&128 != 0}, source, kind)
			var codes []int32
			for _, d := range file.Diagnostics() {
				codes = append(codes, d.Code())
			}
			return codes
		}
		got, want := parse("/main."+ext, source), parse("/main.ts", twin)
		if !ordinary && (len(want) != 1 || want[0] != 1260) {
			t.Fatalf("native await control changed: %v", want)
		}
		if !slices.Equal(got, want) {
			Gap(t, fiberKeywordTarget, "keyword:"+key, "Appendix A literal fiber keywords retain native lexical diagnostics: got %v want %v\n%s", got, want, source)
		}
		ExpectPending(t, fiberKeywordTarget, "keyword:"+key)
		ExpectPending(t, fiberKeywordTarget, specCorpusKey(t))
	})
}
