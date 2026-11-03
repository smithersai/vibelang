package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const doContextualResultQuote = "Contextual typing reaches only the expression alternatives contributing to the normal result; discarded intermediate expressions and outward returns retain their own source contexts."

func requireDoContextualResultQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), doContextualResultQuote) {
		t.Fatal("chapter 2 do contextual-typing quote changed")
	}
}

func TestDoContextualResultQuoted(t *testing.T) { requireDoContextualResultQuote(t) }

// TestDoContextualResult enforces Chapter 2, docs/design/src/002-running.md:
// "Contextual typing reaches only the expression alternatives contributing to
// the normal result; ..." A written Selection type must contextually type the
// alternatives a do expression's normal result comes from, so a literal _tag
// stays a literal instead of widening to string (TS2322).
//
// Witness: foldkit-121, experimental/machine/machine.vibe selectFromGuardList,
// a match arm whose do block ends in a conditional (inbox/migrate-foldkit.md).
// Neighbourhood: the context's source (match arm, annotated const, arrow return
// type, call argument, return statement) x the contributing form (conditional,
// nested conditional, parenthesized conditional, object literal, conditional
// after a discarded intermediate expression). Each wrong-tag twin must still
// report TS2322, so the oracle cannot pass by accepting everything.
func TestDoContextualResult(t *testing.T) {
	requireDoContextualResultQuote(t)
	w := NewWorkspace(t)
	const types = `type Edge = { readonly _tag: "When"; readonly condition: boolean } | { readonly _tag: "Otherwise" }
type Selection = { readonly _tag: "SelectedEdge"; readonly value: number } | { readonly _tag: "IgnoredEdge"; readonly reason: "GuardFailed" }
declare function take(selection: Selection): void
`
	results := []struct{ key, body string }{
		{"conditional", `const condition = guarded.condition; condition ? { _tag: "SelectedEdge", value: 1 } : { _tag: "IgnoredEdge", reason: "GuardFailed" }`},
		{"nested-conditional", `const condition = guarded.condition; condition ? { _tag: "SelectedEdge", value: 1 } : condition === false ? { _tag: "IgnoredEdge", reason: "GuardFailed" } : { _tag: "SelectedEdge", value: 2 }`},
		{"parenthesized", `const condition = guarded.condition; (condition ? { _tag: "SelectedEdge", value: 1 } : { _tag: "IgnoredEdge", reason: "GuardFailed" })`},
		{"object", `const condition = guarded.condition; ({ _tag: "SelectedEdge", value: condition ? 1 : 0 })`},
		{"discarded-intermediate", `({ _tag: "Unrelated" }); guarded.condition ? { _tag: "SelectedEdge", value: 1 } : { _tag: "IgnoredEdge", reason: "GuardFailed" }`},
	}
	contexts := []struct{ key, source string }{
		// foldkit-121's shape: the match result is the arrow's written return type.
		{"match-arm", "export const select = (edge: Edge): Selection => match (edge) {\n  when { _tag: \"When\" } and let guarded: do { %BODY% };\n  when { _tag: \"Otherwise\" }: ({ _tag: \"SelectedEdge\", value: 0 });\n}\n"},
		{"annotated-const", "export function select(guarded: { readonly condition: boolean }) {\n  const selection: Selection = do { %BODY% }\n  return selection\n}\n"},
		{"arrow-return", "export const select = (guarded: { readonly condition: boolean }): Selection => do { %BODY% }\n"},
		{"call-argument", "export function select(guarded: { readonly condition: boolean }) {\n  take(do { %BODY% })\n}\n"},
		{"return-statement", "export function select(guarded: { readonly condition: boolean }): Selection {\n  return do { %BODY% }\n}\n"},
	}
	for _, c := range contexts {
		for _, r := range results {
			key := c.key + "/" + r.key
			t.Run(key, func(t *testing.T) {
				valid := types + strings.ReplaceAll(c.source, "%BODY%", r.body)
				result, err := w.Compile(t.Context(), Single(valid))
				if err != nil {
					t.Fatal(err)
				}
				defer result.Remove()
				if HasError(result.Diagnostics) {
					Gap(t, "TestDoContextualResult", key, "Chapter 2: %q\nreports %v for:\n%s", doContextualResultQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), valid)
					return
				}
				wrong := types + strings.ReplaceAll(c.source, "%BODY%", strings.ReplaceAll(r.body, `"SelectedEdge"`, `"MissingEdge"`))
				negative, err := w.Compile(t.Context(), Single(wrong))
				if err != nil {
					t.Fatal(err)
				}
				defer negative.Remove()
				found := false
				for _, k := range Keys(negative.Dir, negative.Diagnostics) {
					if strings.Contains(k.String(), "TS2322") || strings.Contains(k.String(), "TS2345") {
						found = true
					}
				}
				if !found {
					t.Fatalf("the contextual type must still reject a wrong _tag; got %v for:\n%s", SortedKeys(Keys(negative.Dir, negative.Diagnostics)), wrong)
				}
			})
		}
	}
}
