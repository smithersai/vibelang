package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNamedSpanGenericRequirements(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"generic", `export const original = Effect.fn("read")(function* <A, E, R>(value: Effect.Effect<A, E, R>) { yield* Effect.scope; return yield* value; });`},
		{"constrained", `export const original = Effect.fn("read")(function* <A, E, R extends { readonly service: string }>(value: Effect.Effect<A, E, R>) { yield* Effect.scope; return yield* value; });`},
		{"stage", `export const original = Effect.fn("read")(function* <A, E, R>(value: Effect.Effect<A, E, R>) { yield* Effect.scope; return yield* value; }, Effect.as("done"));`},
		{"captured", `export function original<A, E, R>() { return Effect.fn("read")(function* (value: Effect.Effect<A, E, R>) { yield* Effect.scope; return yield* value; }); }`},
		{"union", `export const original = Effect.fn("read")(function* <A, E, R>(value: Effect.Effect<A, E, R | { readonly service: string }>) { yield* Effect.scope; return yield* value; });`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Establish that two unchanged originals are mutually assignable
			// before using the same oracle on the converted function.
			baseline := tc.source + "\n" + strings.ReplaceAll(tc.source, "original", "baseline") + "\nconst baselineForward: typeof original = baseline;\nconst baselineBackward: typeof baseline = original;\n"
			if errors := errorsOf(t, baseline); len(errors) != 0 {
				t.Fatalf("invalid baseline contract: %v", errors)
			}

			program, file, _, _ := editorProgram(t, tc.source+"\n")
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			call := firstGeneratorCall(file.AsNode(), c)
			if call == nil {
				done()
				t.Fatal("missing generator")
			}
			rewrite := planEffectGen(c, file, call)
			done()
			if !rewrite.fixable() {
				t.Fatalf("unexpected refusal: %+v", rewrite)
			}
			fixed := applyEdits(file.Text(), rewrite.edits)
			if strings.Contains(fixed, "function*") {
				t.Fatalf("generator was not converted: %s", fixed)
			}
			fixed = strings.ReplaceAll(fixed, "original", "converted")
			checked, checkedFile, _, _ := editorProgram(t, tc.source+"\n"+fixed+"\nconst forward: typeof original = converted;\nconst backward: typeof converted = original;\n")
			for _, diagnostic := range append(checked.GetSyntacticDiagnostics(t.Context(), checkedFile), checked.GetSemanticDiagnostics(t.Context(), checkedFile)...) {
				if diagnostic.Category() == diagnostics.CategoryError {
					t.Errorf("generic contract changed: %s\n%s", diagnostic.String(), fixed)
				}
			}
		})
	}
}
