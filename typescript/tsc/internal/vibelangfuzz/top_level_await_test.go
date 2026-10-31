package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The rules TestTopLevelAwait checks, quoted from the chapters (foldkit-42:
// `export const answer = await Promise.resolve(42)` in a .vibe module was
// EK4602 and EK1001, and emitted $await).
var topLevelAwaitQuotes = []struct{ chapter, quote string }{
	{"001-functions.md", "- `await` at the top level is ES top-level await of a Promise. `await` on an Effect there is `EK0103`."},
	{"002-running.md", "`await`, `for await` and `await using` inside effect code are errors"},
}

func TestTopLevelAwaitQuoted(t *testing.T) {
	for _, q := range topLevelAwaitQuotes {
		if !strings.Contains(SpecText(q.chapter), q.quote) {
			t.Errorf("chapter %s no longer says %q; update the quote", q.chapter, q.quote)
		}
	}
}

// TestTopLevelAwait puts await of a Promise and of an Effect in each place
// a module's top level reaches without a function boundary (a declaration,
// a statement, a block, a for...of body, a try block) and in effect
// code at the top level and in a function. At the top level a Promise is
// awaited as JavaScript awaits it, and an Effect is EK0103; in effect code
// either is an error.
func TestTopLevelAwait(t *testing.T) {
	w := NewWorkspace(t)
	operands := map[string]string{"promise": "Promise.resolve(1)", "effect": "Effect.succeed(1)"}
	topLevel := map[string]string{
		"declaration": "export const v = await {E}\n",
		"statement":   "await {E}\n",
		"block":       "if (Math.random() >= 0) { await {E} }\n",
		"for-of":      "for (const _ of [1]) { await {E} }\n",
		"try":         "try { await {E} } finally { }\n",
	}
	effectCode := map[string]string{
		"effect-function": "export effect function f() { return await {E} }\n",
		"effect-block":    "export const p = effect { return await {E} }\n",
	}
	check := func(t *testing.T, source string, want func(codes []int32, js string) string) {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []int32
		var texts []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
				texts = append(texts, specDiagnosticText(d))
			}
		}
		if problem := want(codes, r.Outputs["out/main.js"]); problem != "" {
			Gap(t, "TestTopLevelAwait", "top-level-await", "%s\n%s\nerrors: %v\n%s", problem, source, texts, r.Outputs["out/main.js"])
		}
	}
	for name, template := range topLevel {
		for operand, text := range operands {
			t.Run(name+"-"+operand, func(t *testing.T) {
				check(t, strings.ReplaceAll(template, "{E}", text), func(codes []int32, js string) string {
					if operand == "promise" {
						if len(codes) != 0 || !strings.Contains(js, "await Promise.resolve(1)") || strings.Contains(js, "$await") {
							return "a Promise awaited at the top level is ES top-level await, with no error"
						}
						return ""
					}
					// The legacy analyzer may add EK1001 for the Effect call itself (VIP-1 flip, core-land).
					if !slices.Contains(codes, 103) || strings.Contains(js, "$await") {
						return "an Effect awaited at the top level is EK0103, and the await stays ES await"
					}
					return ""
				})
			})
		}
	}
	for name, template := range effectCode {
		for operand, text := range operands {
			t.Run(name+"-"+operand, func(t *testing.T) {
				check(t, strings.ReplaceAll(template, "{E}", text), func(codes []int32, js string) string {
					if len(codes) == 0 {
						return "await in effect code is an error"
					}
					return ""
				})
			})
		}
	}
}
