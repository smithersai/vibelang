package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-44 selects library types through their ordinary type bindings;
// qualifying a name by globalThis does not change that binding.
// Exercise aliases and nested schema positions as well as direct fields.
func TestSchemaQualifiedLibraryTypes(t *testing.T) {
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		for _, field := range []string{"globalThis.%s", "(globalThis.%s)", "globalThis.%s | null", "readonly globalThis.%s[]", "ReadonlySet<globalThis.%s>", "ReadonlyMap<globalThis.%s, number>", "Record<string, globalThis.%s>"} {
			field := fmt.Sprintf(field, name)
			t.Run(field, func(t *testing.T) {
				for _, modifier := range []string{"readonly ", "", "readonly opt?: string; "} {
					source := "export schema Example { " + modifier + "value: " + field + " }\nexport schema Alias = " + field
					if ds := errorsOf(t, source); len(ds) != 0 {
						t.Fatalf("%v\n%s", ds, source)
					}
				}
			})
		}
	}
}

func TestSchemaQualifiedLibraryShadowing(t *testing.T) {
	for _, source := range []string{
		"namespace Custom { export type Date = string; export const Date = Schema.String } export schema S { readonly value: Custom.Date }",
		"const globalThis = { Date: Schema.Number }; export schema S { readonly value: Date }",
	} {
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Fatalf("%v\n%s", ds, source)
		}
	}
	for _, source := range []string{
		"namespace Custom { export class Date {} } export schema S { readonly value: Custom.Date }",
		"namespace Custom { export class Error {} } export schema S { readonly value: Custom.Error }",
	} {
		ds := errorsOf(t, source)
		if len(ds) != 1 || ds[0].Code() != EK2109.Code {
			t.Fatalf("want EK2109, got %v\n%s", ds, source)
		}
	}
}

func TestSchemaQualifiedLibraryStandaloneAliases(t *testing.T) {
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		for _, emit := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/emit=%t", name, emit), func(t *testing.T) {
				source := "export schema Example = globalThis." + name
				config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"noEmit":%t},"files":["main.vibe"]}`, !emit)
				program, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
				semantic := program.GetSemanticDiagnostics(t.Context(), file)
				declarations := program.GetDeclarationDiagnostics(t.Context(), file)
				for phase, ds := range map[string][]*ast.Diagnostic{"semantic": semantic, "declaration": declarations} {
					for _, d := range ds {
						if d.Category() == diagnostics.CategoryError {
							t.Errorf("%s: %s", phase, d.String())
						}
					}
				}
				c, release := program.GetTypeCheckerForFile(t.Context(), file)
				defer release()
				for _, ref := range file.VibeLangSchemaGenerics {
					symbol := c.ResolveEntityName(ref.Name, ast.SymbolFlagsType)
					t.Logf("reference kind=%v parent=%v binding=%v library=%t selected=%t", ref.Expression.Kind, ref.Expression.Parent.Kind, symbol != nil, isGlobal(c, symbol), schemaGenericReplacement(c, ref.Expression) != nil)
				}
			})
		}
	}
}
