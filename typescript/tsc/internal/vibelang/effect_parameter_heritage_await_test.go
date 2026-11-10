package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var heritageAwaitHomes = []struct{ key, source string }{
	{"declaration", "export effect function read(%s) { return 0 }"},
	{"expression", "export const read = effect function(%s) { return 0 }"},
	{"arrow", "export const read = effect (%s) => 0"},
	{"method", "export class Home { effect read(%s) { return 0 } }"},
	{"object", "export const home = { effect read(%s) { return 0 } }"},
	{"producer", "export effect function* read(%s) { yield 0 }"},
}

// A class base expression evaluates in the surrounding parameter initializer.
// The constructor assertion isolates placement from the base's recovery type.
func TestEffectParameterHeritageAwait(t *testing.T) {
	for _, home := range heritageAwaitHomes {
		for _, operand := range []struct{ key, value string }{
			{"promise", "Promise.resolve(class {})"},
			{"scalar", "1"},
			{"any", "(undefined as any)"},
			{"effect", "Effect.succeed(class {})"},
		} {
			for _, moved := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/moved-%t", home.key, operand.key, moved), func(t *testing.T) {
					parameter := "base = class extends ((await " + operand.value + ") as any) {}"
					if moved {
						parameter = "early = do { if (false) return; 0 }, " + parameter
					}
					source := "import { Effect } from \"effect\";\n" + fmt.Sprintf(home.source, parameter)
					program, file, _, _ := editorProgram(t, source)
					var errors []string
					placement := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Source() == diagnosticSource && d.Code() == 102 {
							placement++
						} else {
							errors = append(errors, d.String())
						}
					}
					if placement != 1 || len(errors) != 0 {
						t.Fatalf("want only EK0102, got count=%d other=%v", placement, errors)
					}
				})
			}
		}
	}
}

func TestEffectParameterHeritageNestedAsync(t *testing.T) {
	for _, home := range heritageAwaitHomes {
		t.Run(home.key, func(t *testing.T) {
			parameter := "base = (async () => class extends ((await Promise.resolve(class {})) as any) {})()"
			program, file, _, _ := editorProgram(t, fmt.Sprintf(home.source, parameter))
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("nested async heritage must keep its native context: %s", d.String())
				}
			}
		})
	}
}

func TestAsyncParameterHeritageKeepsNativeError(t *testing.T) {
	source := "export async function read(base = class extends ((await Promise.resolve(class {})) as any) {}) { return 0 }"
	program, file, _, _ := editorProgram(t, source)
	var errors []int32
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d.Code())
		}
	}
	if len(errors) != 1 || errors[0] != 2524 {
		t.Fatalf("want only TS2524, got %v", errors)
	}
}
