package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestVIP3OmittedRequirementIsNever(t *testing.T) {
	for _, annotation := range []string{"number!never", "number!!", "Effect.Effect<number>"} {
		program, file, _, _ := editorProgram(t, "import { Effect, Context } from \"effect\"\nservice Input { value: number }\nexport effect function read(): "+annotation+" { return (try Input).value }\n")
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			t.Log(d.String())
			if d.Source() == diagnosticSource && d.Code() == EK9202.Code {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: omitted requirement must be never", annotation)
		}
	}
}

// The retired rule inferred R through calls of functions that also left R
// out, so both members of a cycle get the R the cycle needs.
func TestVIP3RequirementMigrationSolvesCycles(t *testing.T) {
	program, file, _, _ := editorProgram(t, "service Audit { note(n: number): void!! }\neffect function isEven(n: number): boolean!never { return n === 0 ? true : !(try isOdd(n - 1)) }\neffect function isOdd(n: number): boolean!never { try (try Audit).note(n); return n === 0 ? false : !(try isEven(n - 1)) }\nexport const f = isEven\n")
	var fixes []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4853.Code {
			fixes = append(fixes, d.String())
		}
	}
	if len(fixes) != 2 {
		t.Fatalf("got %d EK4853 fixes, want one for each member of the cycle: %v", len(fixes), fixes)
	}
}

// A callback without a contract may need any R, which the caller's
// declaration cannot name, so nothing is written.
func TestVIP3RequirementMigrationSkipsUnnameableRequirements(t *testing.T) {
	program, file, _, _ := editorProgram(t, "error Boom\nexport effect function raise(make: () => Boom): number!Boom { throw make() }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4853.Code {
			t.Fatalf("unexpected fix: %s", d.String())
		}
	}
}

// VIP-3 requirement migration warning and mechanical fix, cycles and unnameable controls; rule: docs/design/vips/0003-effect-type-shorthand.md#26cd1ca9d30326dc

// VIP-3 retires written infer slots: a required migration error is not lint.
func TestVIP3InferSlotCannotBeDisabled(t *testing.T) {
	program, file, _, _ := editorProgram(t, "// @vibelang-diagnostics-next-line EK4857:off\nexport effect function one(): number!infer E { return 1 }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4857.Code {
			if d.Category() != diagnostics.CategoryError {
				t.Fatalf("infer slot migration became %v", d.Category())
			}
			return
		}
	}
	t.Fatal("a diagnostic directive disabled the required infer-slot migration")
}
