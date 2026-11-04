package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The generator's written return type contextualizes its return expressions.
// Keep that contract when the same cold program is written with effect.
func TestEffectGenWrittenReturn(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"fn-return", "export const f = () => Effect.gen(function* (): Effect.fn.Return<{ readonly kind: \"ok\" }> { return { kind: \"ok\" } })"},
		{"failure", "export const f = (bad: boolean) => Effect.gen(function* (): Effect.fn.Return<{ readonly kind: \"ok\" }, string> { if (bad) return yield* Effect.fail(\"bad\"); return { kind: \"ok\" } })"},
		{"generic", "export const f = <A>(a: A) => Effect.gen(function* (): Effect.fn.Return<{ readonly value: A }> { return { value: a } })"},
		{"default", "export const f = (n = 1) => Effect.gen(function* (): Effect.fn.Return<{ readonly value: number }> { return { value: n } })"},
		{"pipeline", "export const f = () => Effect.gen(function* (): Effect.fn.Return<{ readonly kind: \"ok\" }> { return { kind: \"ok\" } }).pipe(Effect.map(value => value.kind))"},
		{"requirements", "type Required = { readonly service: unique symbol }\ndeclare const work: Effect.Effect<number, never, Required>\nexport const f = () => Effect.gen(function* (): Effect.fn.Return<{ readonly kind: \"ok\" }, never, Required> { yield* work; return { kind: \"ok\" } })"},
		{"held", "export const value = Effect.gen(function* (): Effect.fn.Return<{ readonly kind: \"ok\" }> { return { kind: \"ok\" } })"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source+"\n")
			if !ok {
				t.Fatalf("no quick fix: %s", effectGenNotes(t, test.source+"\n"))
			}
			if strings.Contains(got, "function*") || strings.Contains(got, "any") {
				t.Fatalf("lost typed conversion: %s", got)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s\n%s", d.String(), got)
				}
			}
		})
	}
}

// An explicit JavaScript iterator contract already selects a native generator.
func TestEffectGenExplicitIteratorReturnPreserved(t *testing.T) {
	const source = "export const f = () => Effect.gen(function* (): Generator<Effect.Effect<unknown>, { readonly kind: \"ok\" }, never> { yield* Effect.void; return { kind: \"ok\" } })\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("native iterator control: %s", d.String())
		}
	}
}
