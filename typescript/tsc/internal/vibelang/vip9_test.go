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
		"service Flags { static readonly defaultValue = () => ({ enabled: true }); enabled: boolean }\nexport effect function read(): boolean!! { return (try Flags).enabled }",
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

// VIP-9 abstract-service and default-thunk migration, including corresponding reads; rule: docs/design/vips/0009-service-declarations.md#2af24879e9d81ad6
// VIP-9 abstract-service and default-thunk migration, including corresponding reads; rule: docs/design/vips/0009-service-declarations.md#c375919198020a1c

// VIP-9 (amended): a member is typed as in an interface. An omitted type
// follows noImplicitAny (TS7010 for a method, TS7008 for a property), an
// explicit any or plain type is valid, and VibeLang adds no diagnostic.
func TestVIP9OmittedMemberTypesFollowTypeScript(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export service Reader { static readonly key = \"vip9/Reader\"; read(); value; count(): number }\n")
	var codes []int32
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
		}
	}
	if len(codes) != 2 || codes[0] != 7010 || codes[1] != 7008 {
		t.Fatalf("got %v, want [7010 7008]", codes)
	}
	program, file, _, _ = editorProgram(t, "export service Reader { static readonly key = \"vip9/Reader\"; read(): any; value: any; count(): number; load(): number!! }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("explicit member types: %s", d.String())
		}
	}
}
