package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-9's member alias and a native namespace value occupy different meanings.
// TypeScript allows an alias and a value with the same name.
func TestServiceNamespaceValueShape(t *testing.T) {
	const service = "export service S { static readonly key = \"namespace/S\"; n: number }\n"
	for _, tc := range []struct {
		name, source string
		want         []int32
	}{
		{"constant", service + "export namespace S { export const Shape = 1 }\nexport const impl: S.Shape = { n: 1 }; export const value: number = S.Shape; export const query: typeof S.Shape = 1\n", nil},
		{"object", service + "export namespace S { export const Shape = { token: \"shape\" } }\nexport const impl: S.Shape = { n: 1 }; export const query: typeof S.Shape = { token: \"shape\" }\n", nil},
		{"function", service + "export namespace S { export function Shape() { return \"shape\" } }\nexport const impl: S.Shape = { n: 1 }; export const value: string = S.Shape(); export const query: ReturnType<typeof S.Shape> = \"shape\"\n", nil},
		{"recursive", "export service S { static readonly key = \"namespace/S\"; peer?: S.Shape }\nexport namespace S { export const Shape = 1 }\nexport const impl: S.Shape = { peer: {} }\n", nil},
		{"value alias", service + "namespace Values { export const value = 1 }\nexport namespace S { export import Shape = Values.value }\nexport const impl: S.Shape = { n: 1 }; export const query: typeof S.Shape = 1\n", nil},
		{"alias chain", service + "namespace Values { export const value = 1 }\nnamespace Aliases { export import value = Values.value }\nexport namespace S { export import Shape = Aliases.value }\nexport const impl: S.Shape = { n: 1 }; export const query: typeof S.Shape = 1\n", nil},
		{"namespace value", service + "export namespace S { export namespace Shape { export const value = 1 } }\nexport const impl: S.Shape = { n: 1 }; export const query: typeof S.Shape = S.Shape; export const value: number = S.Shape.value\n", nil},
		{"whole shape type and value", "export service S: { n: number } { static readonly key = \"namespace/S\" }\nexport namespace S { export type Shape = { z: number }; export const Shape = 1 }\nexport const impl: S.Shape = { z: 1 }; export const query: typeof S.Shape = 1\n", nil},
		{"native class", "export class S {}\nexport namespace S { export const Shape = 1 }\nexport const impl: S.Shape = {}\n", []int32{2749}},
		{"written shape", "export service S: { n: number } { static readonly key = \"namespace/S\" }\nexport namespace S { export const Shape = 1 }\nexport const impl: Context.Service.Shape<typeof S> = { n: 1 }; export const query: typeof S.Shape = 1\n", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			var got []int32
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("errors %v, want %v; %s", got, tc.want, tc.source)
			}
			if slices.Contains([]string{"constant", "object", "function", "recursive", "value alias", "alias chain", "namespace value"}, tc.name) {
				checkServiceDeclarationTypes(t, serviceAliasDeclaration(t, tc.source))
			}
		})
	}
}
