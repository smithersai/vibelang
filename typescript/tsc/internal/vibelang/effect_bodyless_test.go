package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
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

func TestEffectBodylessFix(t *testing.T) {
	for _, source := range []string{
		"declare effect /* keep */ function read(): number!!; export {};",
		"abstract class C { abstract effect /* keep */ read(): number!! }; export {};",
		"declare namespace API { effect function read(): number!! }; export {};",
		"interface C { effect /* keep */ read(): number!! }; export {};",
		"type C = { effect value: number }; export {};",
	} {
		result, name := fixVIPOnlySource(t, source)
		if len(result.Refused) != 0 {
			t.Fatalf("fix refused: %+v", result.Refused)
		}
		fixed := result.Files[name]
		if want := strings.Replace(source, "effect", "", 1); fixed == nil || fixed.Text != want {
			t.Fatalf("got %+v, want %q; refused %+v; err %v", fixed, want, result.Refused, result.Err)
		}
	}
}
