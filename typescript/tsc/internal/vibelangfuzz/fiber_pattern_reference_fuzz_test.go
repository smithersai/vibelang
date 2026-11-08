package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const fiberPatternNotQuote = "`not` MatchPattern[?Yield, ?Await]"

func TestFiberPatternReferenceQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), grammarFiberReferenceQuote) {
		t.Fatal(grammarFiberReferenceQuote)
	}
	if !strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), fiberPatternNotQuote) {
		t.Fatal(fiberPatternNotQuote)
	}
}

// Appendix A reserves IdentifierReferences, while member names and ordinary
// callable bodies retain their own contexts. Each keyed shape varies the word,
// its spelling, trivia and the enclosing execution context.
func FuzzFiberPatternReference(f *testing.F) {
	startShortBudget(f)
	patterns := map[string]string{
		"bare": "W", "member": "W.C", "computed": "W[0]",
		"not": "not W", "group": "(W)", "array": "[W]",
		"object": "{ value: W }", "extractor": "W(let value)",
		"instanceof": "instanceof W.C", "in": "in W",
		"less": "< W", "negative": "-W", "positive": "+W",
		"less-negative": "< -W", "less-positive": "< +W",
		"property-control": "holder.W",
	}
	for _, word := range []string{"fork", "join"} {
		for shape := range patterns {
			f.Add(word+":"+shape, byte(0))
			f.Add(word+":"+shape, byte(3))
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestFiberPatternReferenceQuoted(t)
		parts := strings.Split(key, ":")
		if len(parts) != 2 || parts[0] != "fork" && parts[0] != "join" {
			t.Skip()
		}
		pattern, ok := patterns[parts[1]]
		if !ok {
			t.Skip()
		}
		word := parts[0]
		if variant&16 != 0 {
			word = `\u` + map[string]string{"fork": "0066ork", "join": "006aoin"}[word]
		}
		pattern = strings.ReplaceAll(pattern, "W", word)
		gap := []string{" ", "/* pattern */", "\n", "\t"}[variant/4%4]
		pattern = strings.ReplaceAll(pattern, " ", gap)
		expression := "p is " + pattern
		if variant&32 != 0 {
			expression = "match (p) { when " + pattern + ": true; default: false; }"
		}
		source := "effect function f(p) { return " + expression + " }"
		want := 1
		switch variant % 4 {
		case 1:
			source = "const f = effect { " + expression + "; }"
		case 2:
			source = "effect function* f(p) { yield " + expression + " }"
		case 3:
			source = "effect function f(p) { return () => " + expression + " }"
			want = 0
		}
		if parts[1] == "property-control" {
			want = 0
		}
		// The pinned not production has no line-terminator restriction.
		// Keep its separate parsing gap precisely keyed; ordinary-callable
		// controls do not inherit that debt.
		if want == 1 && parts[1] == "not" && strings.Contains(pattern, "\n") {
			key += "-line-break"
		}
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{
			FileName: "/pattern/main.vibe", PathKey: "/pattern/main.vibe",
		}, source)
		got := 0
		for _, d := range file.Diagnostics() {
			if d.Code() == parser.ReservedFiberNameDiagnosticCode {
				got++
			}
		}
		if got != want {
			Gap(t, "FuzzFiberPatternReference", key, "%s: got %d EK1702 reports, want %d\n%s", grammarFiberReferenceQuote, got, want, source)
			return
		}
		ExpectPending(t, "FuzzFiberPatternReference", key)
		ExpectPending(t, "FuzzFiberPatternReference", specCorpusKey(t))
	})
}
