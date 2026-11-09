package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestEffectBodylessAdmission(t *testing.T) {
	for i, source := range []string{
		"declare effect function read(): number!!; export {};",
		"abstract class C { abstract effect read(): number!! }; export {};",
		"declare class C { effect read(): number!! }; export {};",
		"declare namespace API { effect function read(): number!! }; export {};",
		"interface C { effect read(): number!! }; export {};",
		"type C = { effect read(): number!! }; export {};",
		"interface C { effect value: number }; export {};",
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 108 && d.Source() == diagnosticSource {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected error: %s", d.String())
				}
			}
			if count != 1 {
				t.Fatalf("want one EK0108, got %d for %s", count, source)
			}
		})
	}
}

func TestEffectBodylessControls(t *testing.T) {
	for i, source := range []string{
		"effect function read(): number!!; effect function read() { return 1 }; export {};",
		"class C { effect read(): number!!; effect read() { return 1 } }; export {};",
		"interface C { effect(): number }; export {};",
		"type C = { effect(): number }; export {};",
		"declare function read(): number!!; export {};",
		"abstract class C { abstract read(): number!! }; export {};",
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("valid control: %s", d.String())
				}
			}
		})
	}
}

// VIP-1 assigns EK0108 independently of native errors on the declare modifier.
func TestEffectDeclaredClassMemberAdmission(t *testing.T) {
	for _, source := range []string{
		"class C { declare effect read(): number!! }; export {};",
		"class C { effect declare read(): number!! }; export {};",
		"class C { public declare effect read(): number!! }; export {};",
		"class C { static declare effect read(): number!! }; export {};",
		"class C { declare effect [\"read\"](): number!! }; export {};",
		"class C { declare effect read<T>(x: T): T!! }; export {};",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			effect, native := 0, 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				switch {
				case d.Source() == diagnosticSource && d.Code() == 108:
					effect++
				case d.Source() == "" && d.Code() == 1031:
					native++
				case d.Category() == diagnostics.CategoryError:
					t.Errorf("unexpected error: %s", d.String())
				}
			}
			if effect != 1 || native != 1 {
				t.Fatalf("want one EK0108 and native TS1031, got %d and %d", effect, native)
			}
		})
	}
}
