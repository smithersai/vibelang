package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestEffectFnBareReturnContracts(t *testing.T) {
	for _, tc := range []struct {
		name, params, result, body string
		allowed                    bool
	}{
		{"generic", "<A>(value: A)", "A", "{ yield* Effect.succeed(value); return }", false},
		{"number", "(value: number)", "number", "yield* Effect.succeed(value); return", false},
		{"union", "(value: number)", "number | string", "yield* Effect.succeed(value); if (value) return 1; return", false},
		{"void", "(value: number)", "void", "yield* Effect.succeed(value); return", true},
		{"undefined", "(value: number)", "undefined", "yield* Effect.succeed(value); return", true},
		{"optional", "(value: number)", "number | undefined", "yield* Effect.succeed(value); if (value) return value; return", true},
		{"nested", "<A>(value: A)", "A", "function ignored() { return }; yield* Effect.succeed(value); return value", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := fmt.Sprintf("import * as Effect from \"effect/Effect\"\nexport const identity = Effect.fn(\"identity\")(function* %s: Effect.fn.Return<%s> { %s })\n", tc.params, tc.result, tc.body)
			fixed, ok := effectGenQuickFix(t, source)
			if !tc.allowed && ok {
				t.Fatalf("invalid written contract received a fix:\n%s", fixed)
			}
			if !tc.allowed && !strings.Contains(effectGenNotes(t, source), "bare return") {
				t.Fatal("missing return-contract refusal reason")
			}
			if tc.allowed {
				if !ok || strings.Contains(fixed, "Effect.fn(") {
					t.Fatalf("valid contract was refused:\n%s", fixed)
				}
				program, file, _, _ := editorProgram(t, fixed)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("valid contract: %s\n%s", d.String(), fixed)
					}
				}
			}
		})
	}
}
