package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var decoratorParameterHomes = []struct{ key, source string }{
	{"declaration", "export effect function read(%s) { return 0 }"},
	{"expression", "export const read = effect function(%s) { return 0 }"},
	{"arrow", "export const read = effect (%s) => 0"},
	{"method", "export class Home { effect read(%s) { return 0 } }"},
	{"object", "export const home = { effect read(%s) { return 0 } }"},
	{"producer", "export effect function* read(%s) { yield 0 }"},
}
var decoratorParameterHeads = []struct{ key, source string }{
	{"class", "@(KEY) class {}"},
	{"method", "class { @(KEY) read() {} }"},
	{"field", "class { @(KEY) value = 1 }"},
	{"getter", "class { @(KEY) get read() { return 1 } }"},
	{"setter", "class { @(KEY) set read(value: number) {} }"},
}

func TestEffectParameterDecoratorAwait(t *testing.T) {
	for _, head := range decoratorParameterHeads {
		for _, home := range decoratorParameterHomes {
			for _, operand := range []struct{ key, value string }{
				{"promise", "Promise.resolve(\"read\")"},
				{"scalar", "1"},
				{"any", "(undefined as any)"},
				{"effect", "Effect.succeed(\"read\")"},
			} {
				for _, moved := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/%s/moved-%t", head.key, home.key, operand.key, moved), func(t *testing.T) {
						key := "((await " + operand.value + ") as unknown as typeof decorate)"
						parameter := "base = " + strings.ReplaceAll(head.source, "KEY", key)
						if moved {
							parameter = "early = do { if (false) return; 0 }, " + parameter
						}
						source := "import {Effect} from \"effect\";\nconst decorate = (...args: any[]) => {};\n" + fmt.Sprintf(home.source, parameter)
						program, file, _, _ := editorProgram(t, source)
						var errors []string
						found := 0
						for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							if d.Source() == diagnosticSource && d.Code() == 102 {
								found++
							} else {
								errors = append(errors, d.String())
							}
						}
						if found != 1 || len(errors) != 0 {
							t.Fatalf("want only EK0102, got count=%d other=%v", found, errors)
						}
					})
				}
			}
		}
	}
}

func TestEffectParameterDecoratorNestedAsync(t *testing.T) {
	for _, home := range decoratorParameterHomes {
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

func TestEffectParameterDecoratorAsyncBody(t *testing.T) {
	for _, head := range decoratorParameterHeads {
		t.Run(head.key, func(t *testing.T) {
			key := "((await Promise.resolve(decorate)) as unknown as typeof decorate)"
			expression := strings.ReplaceAll(head.source, "KEY", key)
			source := "const decorate = (...args: any[]) => {};\nexport async function read() { const value = " + expression + "; return value }"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("definition head in native async body: %s", d.String())
				}
			}
		})
	}
}

func TestEffectParameterDecoratorNestedAsyncArrow(t *testing.T) {
	for _, home := range decoratorParameterHomes {
		t.Run(home.key, func(t *testing.T) {
			source := "const decorate = (...args: any[]) => {};\n" + fmt.Sprintf(home.source, "base = async () => (@(await Promise.resolve(decorate)) class {})")
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("nested async arrow: %s", d.String())
				}
			}
		})
	}
}
