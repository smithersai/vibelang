package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const effectBlockLintTarget = "FuzzMigrationEffectBlockLint"
const effectBlockProductionQuote = "EffectBlock = EffectModifier [no LineTerminator here] \"{\" FunctionBody[~Yield, ~Await, +Effect] \"}\""
const effectBlockSafeFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestMigrationEffectBlockLintQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"900-appendices.md": effectBlockProductionQuote,
		"007-tooling.md":    effectBlockSafeFixQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func FuzzMigrationEffectBlockLint(f *testing.F) {
	startShortBudget(f)
	forms := []string{"bare", "nested", "arrow-inside", "effect-arrow"}
	for _, form := range forms {
		for depth := range uint8(4) {
			f.Add(form, depth)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, form string, depth uint8) {
		TestMigrationEffectBlockLintQuoted(t)
		if !slices.Contains(forms, form) {
			if form == "" {
				return
			}
			form = forms[int(form[0])%len(forms)]
		}
		depth %= 4
		expression := "effect { return 1 }"
		switch form {
		case "nested":
			expression = "effect { return try effect { return 2 } }"
		case "arrow-inside":
			expression = "effect { const f = (n: number): number => { return n + 1 }; return f(1) }"
		case "effect-arrow":
			expression = "effect (n: number) => { return n + 1 }"
		}
		if form == "effect-arrow" && depth > 0 {
			expression = "(" + expression + ")(1)"
		}
		for range depth {
			expression = "effect { return try " + expression + " }"
		}
		source := "export const program = " + expression + "\n"
		var result *Result
		var err error
		within(t, "compile", func() {
			result, err = w.Compile(t.Context(), Project{
				Files:  map[string]string{"main.vibe": source},
				Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out"},"vibe":{"severities":{"EK38123":"error"}}}`,
			})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		arrows := 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && (d.Code() == 4823 || d.Code() == 38123) {
				arrows++
			} else if d.Category().Name() == "error" {
				t.Fatalf("invalid lint witness: %s%d: %s", d.Source(), d.Code(), d.MessageText())
			}
		}
		expected := 0
		if form == "arrow-inside" || form == "effect-arrow" {
			expected = 1
		}
		key := fmt.Sprintf("feature:%s:%d", form, depth)
		if arrows != expected {
			Gap(t, effectBlockLintTarget, key, "Appendix A: %q; required Effect-block braces cannot be replaced by a concise arrow body. Want EK38123 on %d real arrows, got %d\n%s", effectBlockProductionQuote, expected, arrows, source)
		}
		ExpectPending(t, effectBlockLintTarget, key)
		ExpectPending(t, effectBlockLintTarget, specCorpusKey(t))
	})
}
