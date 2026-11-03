package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const catchValueDiagnosticQuote = "Anything else after `catch` is a syntax error (`EK0509`): a name, a call, any other value"
const catchInvalidGeneratorQuote = "or a generator or `async` generator expression."
const catchSourceDiagnosticQuote = "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their `TS` codes, including independent errors in embedded expressions and types."

func TestCatchValueDiagnosticsQuoted(t *testing.T) {
	for _, rule := range []struct{ chapter, quote string }{
		{"002-running.md", catchValueDiagnosticQuote},
		{"002-running.md", catchInvalidGeneratorQuote},
		{"007-tooling.md", catchSourceDiagnosticQuote},
	} {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q", rule.chapter, rule.quote)
		}
	}
}

// Compare source diagnostics with the same expression outside catch. An invalid
// handler gets EK0509; it must neither invent a call to a value nor hide a bad
// call the author actually wrote. Native syntax uses a TypeScript twin; Effect
// syntax uses the same expression in a normal VibeLang value context, where
// chapter 2 permits it. Runtime behavior stays in FuzzVIPDifferential.
func FuzzCatchValueDiagnostics(f *testing.F) {
	startShortBudget(f)
	domains := []struct{ key, expression, referenceFile string }{
		{"literal", "7", "twin.ts"},
		{"name", "fallback", "twin.ts"},
		{"effect-value", "Effect.succeedNone", "twin.ts"},
		{"effect-call", "Effect.succeed(7)", "twin.ts"},
		{"non-callable", "Effect.succeedNone()", "twin.ts"},
		{"bad-argument", "needsNumber(\"bad\")", "twin.ts"},

		{"generator", "function* () { yield 7 }", "twin.ts"},
		{"named-generator", "function* handler() { yield 7 }", "twin.ts"},
		{"generator-source-error", "function* () { yield missingHandlerValue }", "twin.ts"},
		{"async-function", "async function () { return 7 }", "twin.ts"},
		{"async-generator", "async function* () { yield 7 }", "twin.ts"},
		{"effect-generator", "effect function* () { yield 7 }", "twin.vibe"},
		{"effect-generator-source-error", "effect function* () { yield missingHandlerValue }", "twin.vibe"},
		{"effect-block", "effect { return 7 }", "twin.vibe"},
		{"effect-block-source-error", "effect { return missingHandlerValue }", "twin.vibe"},
	}
	for _, domain := range domains {
		for _, trivia := range []string{"", "|parenthesized", "|comment"} {
			f.Add(domain.key + trivia)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestCatchValueDiagnosticsQuoted(t)
		choice := 0
		if len(key) > 0 {
			choice = int(key[0]) % len(domains)
		}
		name, suffix, _ := strings.Cut(key, "|")
		for i, domain := range domains {
			if name == domain.key {
				choice = i
				break
			}
		}
		domain := domains[choice]
		expression := domain.expression
		switch suffix {
		case "parenthesized":
			expression = "(" + expression + ")"
		case "comment":
			expression = "/* keep source diagnostics */ " + expression
		}
		prefix := "import { Effect } from \"effect\"; const fallback = 7; function needsNumber(n: number) { return n };\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{
			"main.vibe":          prefix + "export effect function main() { return Effect.fail(0) catch " + expression + " }\n",
			domain.referenceFile: prefix + "export const value = " + expression + ";\n",
		}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var actual, reference []string
		admission := 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if inFile(d, "main.vibe") && d.Source() == "EK" && d.Code() == 509 {
				admission++
				continue
			}
			code := fmt.Sprintf("%s%d", d.Source(), d.Code())
			if inFile(d, domain.referenceFile) {
				reference = append(reference, code)
			} else {
				actual = append(actual, code)
			}
		}
		slices.Sort(actual)
		slices.Sort(reference)
		if admission != 1 || !slices.Equal(actual, reference) {
			Gap(t, "FuzzCatchValueDiagnostics", domain.key+"|"+suffix, "VIP-5 requires one EK0509 and retains only independent TypeScript errors: EK0509=%d actual=%v twin=%v\n%s", admission, actual, reference, expression)
		}
	})
}
