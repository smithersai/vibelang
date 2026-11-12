package vibelangfuzz

import (
	"context"
	"testing"
)

// Surveying the underived compiler cases through the oracle found programs
// the oracle failed although the gap was known or the compiler rejects them:
// the `mutable` member marker (registry key admission:mutable-default,
// pending) had no classifier key, and three placement or retirement
// rejections (EK0503, EK1003, EK4857) were not counted as syntax-class.
func TestGrammarAdmissionSurveyedClassifier(t *testing.T) {
	for _, source := range []string{
		"type T = { mutable x: number }",
		"interface Point { mutable x: number; readonly y: number }",
		"schema S { mutable plain?: string }",
		"type T = { readonly a: number; mutable [key: string]: number }",
		"class C { mutable #count = 0 }",
		"type T = {\n\tmutable x: number\n}",
		// The marker wins over the callable-kind guess, which reads a typed
		// Effect arrow or a plain function with a try body as plain code.
		"const f = effect (p: { mutable n: number }): number!! => {\n  return try Effect.succeed(p.n);\n};",
		"const count = effect (state: { mutable runs: number }): number!! => {\n  state.runs++\n  return try Effect.succeed(state.runs)\n}",
		"interface Slot<T> { mutable run: () => T }\nfunction g(slot: Slot<void!!>) { slot.run = effect () => { try sleep(\"1 millis\") } }",
		"export const hatch = effect (value: { mutable n: number }): Effect<number, never, never> => try sync((n: number) => ++n, value.n)",
		"interface Slot { mutable n: number }\nfunction plain(n: number) { return try n }",
	} {
		if got := grammarAdmissionForm(source); got != "admission:mutable-default" {
			t.Errorf("key=%q, want admission:mutable-default: %q", got, source)
		}
	}
	for _, source := range []string{
		"const mutable = 1",
		"type T = { mutable: number }",
		"const o = { mutable }",
		"type T = { mutable\n x: number }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:mutable-default" {
			t.Errorf("control keyed as a mutable member marker: %q", source)
		}
	}
	// Without a marker the callable-kind guess keeps its key.
	for _, source := range []string{
		"const f = (p: { n: number }): number => { return try p.n }",
		"interface Slot { n: number }\nfunction plain(n: number) { return try n }",
	} {
		if got := grammarAdmissionForm(source); got != "admission:function-kind" {
			t.Errorf("key=%q, want admission:function-kind: %q", got, source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range []string{
		"export effect function f() { try { return 1 } catch (e) { return 2 } }",
		"export effect function f(r: AsyncDisposable) { await using h = r; return 1 }",
		"import { Effect } from \"effect\"\nexport const a = (): number!(infer E) => Effect.succeed(1)",
	} {
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		rejected := false
		for _, d := range result.Diagnostics {
			if grammarAdmissionSyntaxDiagnostic(d) {
				rejected = true
			}
		}
		if !rejected {
			t.Errorf("no syntax-class rejection for %q: %v", source, result.Diagnostics)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("rejected effect-body form still reported as an admission gap: %q", source)
		}
	}
}
