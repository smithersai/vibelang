package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var computedParameterHomes = []struct{ key, source string }{
	{"declaration", "export effect function read(%s) { return 0 }"},
	{"expression", "export const read = effect function(%s) { return 0 }"},
	{"arrow", "export const read = effect (%s) => 0"},
	{"method", "export class Home { effect read(%s) { return 0 } }"},
	{"object", "export const home = { effect read(%s) { return 0 } }"},
	{"producer", "export effect function* read(%s) { yield 0 }"},
}
var computedParameterHeads = []struct{ key, source string }{
	{"class-method", "class { [KEY]() { return 1 } }"},
	{"class-field", "class { [KEY] = 1 }"},
	{"class-getter", "class { get [KEY]() { return 1 } }"},
	{"object-method", "{ [KEY]() { return 1 } }"},
	{"object-getter", "{ get [KEY]() { return 1 } }"},
}

func TestEffectParameterComputedAwait(t *testing.T) {
	for _, head := range computedParameterHeads {
		for _, home := range computedParameterHomes {
			for _, operand := range []struct{ key, value string }{
				{"promise", "Promise.resolve(\"read\")"},
				{"scalar", "1"},
				{"any", "(undefined as any)"},
				{"effect", "Effect.succeed(\"read\")"},
			} {
				for _, moved := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/%s/moved-%t", head.key, home.key, operand.key, moved), func(t *testing.T) {
						key := "((await " + operand.value + ") as unknown as \"read\")"
						parameter := "base = " + strings.ReplaceAll(head.source, "KEY", key)
						if moved {
							parameter = "early = do { if (false) return; 0 }, " + parameter
						}
						source := "import {Effect} from \"effect\";\n" + fmt.Sprintf(home.source, parameter)
						program, file, _, _ := editorProgram(t, source)
						var errors []string
						found := 0
						nativeFields := 0
						for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							if d.Source() == diagnosticSource && d.Code() == 102 {
								found++
							} else if head.key == "class-field" && d.Source() != diagnosticSource && d.Code() == 1166 {
								nativeFields++
							} else {
								errors = append(errors, d.String())
							}
						}
						wantNativeFields := 0
						if head.key == "class-field" {
							wantNativeFields = 1
						}
						if found != 1 || nativeFields != wantNativeFields || len(errors) != 0 {
							t.Fatalf("want EK0102 and %d native field-name error, got count=%d native=%d other=%v", wantNativeFields, found, nativeFields, errors)
						}
					})
				}
			}
		}
	}
}

func TestEffectParameterComputedNestedAsync(t *testing.T) {
	for _, home := range computedParameterHomes {
		t.Run(home.key, func(t *testing.T) {
			source := fmt.Sprintf(home.source, "base = class { async read() { return await Promise.resolve(\"read\") } }")
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("nested async body: %s", d.String())
				}
			}
		})
	}
}

func TestEffectParameterComputedAsyncBody(t *testing.T) {
	for _, head := range computedParameterHeads {
		t.Run(head.key, func(t *testing.T) {
			key := "((await Promise.resolve(\"read\")) as unknown as \"read\")"
			expression := strings.ReplaceAll(head.source, "KEY", key)
			source := "export async function read() { const value = " + expression + "; return value }"
			program, file, _, _ := editorProgram(t, source)
			// TypeScript also rejects the dynamic class field key with TS1166.
			nativeFields := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if head.key == "class-field" && d.Source() != diagnosticSource && d.Code() == 1166 {
					nativeFields++
					continue
				}
				t.Fatalf("definition head in native async body: %s", d.String())
			}
			wantNativeFields := 0
			if head.key == "class-field" {
				wantNativeFields = 1
			}
			if nativeFields != wantNativeFields {
				t.Fatalf("native field diagnostics = %d, want %d", nativeFields, wantNativeFields)
			}
		})
	}
}
