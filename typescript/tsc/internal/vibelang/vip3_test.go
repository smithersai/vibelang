package vibelang

import "testing"

func TestVIP3OmittedRequirementIsNever(t *testing.T) {
	for _, annotation := range []string{"number!never", "number!!", "Effect.Effect<number>"} {
		program, file, _, _ := editorProgram(t, "import { Effect, Context } from \"effect\"\nservice Input { value: number }\nexport function read(): "+annotation+" { return Input().value }\n")
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

func TestVIP3RequirementMigration(t *testing.T) {
	source := "service Input { value: number }\nexport function read(): number!never { return Input().value }\n"
	got := applyQuickFix(t, source, EK4853.Code)
	want := "service Input { value: number }\nexport function read(): number!never!Input { return Input().value }\n"
	if got != want {
		t.Fatalf("got %s; want %s", got, want)
	}
}

// The retired rule inferred R through calls of functions that also left R
// out, so both members of a cycle get the R the cycle needs.
func TestVIP3RequirementMigrationSolvesCycles(t *testing.T) {
	program, file, _, _ := editorProgram(t, "service Audit { note(n: number): void!! }\nfunction isEven(n: number): boolean!never { return n === 0 ? true : !isOdd(n - 1) }\nfunction isOdd(n: number): boolean!never { Audit.note(n); return n === 0 ? false : !isEven(n - 1) }\nexport const f = isEven\n")
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
	program, file, _, _ := editorProgram(t, "error Boom\nexport function raise(make: () => Boom): number!Boom { throw make() }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4853.Code {
			t.Fatalf("unexpected fix: %s", d.String())
		}
	}
}
