package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestVIP9AbstractClassIsOrdinary(t *testing.T) {
	_, file, _, _ := editorProgram(t, "abstract class Users { abstract name: string }\n")
	if classKindOf(file.Statements.Nodes[0]) != ordinaryClass {
		t.Fatal("abstract classes must not declare services")
	}
}

func TestVIP9DefaultValueThunk(t *testing.T) {
	for _, source := range []string{
		"service Flags { static readonly defaultValue = () => ({ enabled: true }); enabled: boolean }\nexport function read(): boolean!! { return Flags().enabled }",
		"service Flags { static readonly defaultValue: () => Flags.Shape = () => ({ enabled: true }); enabled: boolean }\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s", d.String())
			}
		}
	}
}

func TestVIP9InvalidDefaultValue(t *testing.T) {
	for _, initializer := range []string{"{ enabled: true }", "() => ({ enabled: 42 })", "() => ({})"} {
		program, file, _, _ := editorProgram(t, "service Flags { static readonly defaultValue = "+initializer+"; enabled: boolean }\n")
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				found = true
			}
		}
		if !found {
			t.Errorf("accepted invalid defaultValue %s", initializer)
		}
	}
}

func TestVIP9ServiceMigration(t *testing.T) {
	got := applyQuickFix(t, "export abstract class Users { abstract name: string }\n", EK4854.Code)
	if got != "export service Users { name: string }\n" {
		t.Fatalf("got %s", got)
	}
	got = applyQuickFix(t, "service Flags { static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n", EK4855.Code)
	want := "service Flags { static readonly defaultValue: () => Flags.Shape = () => ({ enabled: true }); enabled: boolean }\n"
	if got != want {
		t.Fatalf("got %s; want %s", got, want)
	}
}

func TestVIP9ExplicitKeyCollision(t *testing.T) {
	p, file, _, _ := editorProgram(t, "service A { static readonly key = \"app/shared\"; value: number }\nservice B { static readonly key = \"app/shared\"; value: number }\n")
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK3001.Code {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("got %d duplicate-key errors, want 2", count)
	}
}

func TestVIP9DefaultValueMigrationKeepsPlainValues(t *testing.T) {
	got := applyQuickFix(t, "service Prefix: string { static readonly default = \"p\" }\n", EK4855.Code)
	want := "service Prefix: string { static readonly defaultValue = () => \"p\" }\n"
	if got != want {
		t.Fatalf("got %s; want %s", got, want)
	}
}
