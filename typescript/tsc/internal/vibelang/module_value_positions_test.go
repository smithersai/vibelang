package vibelang

import "testing"

// VIP-40: "The name is not a value." IdentifierName positions do not read
// the module binding; actual expressions and local value exports do.
func TestModuleNameValuePositions(t *testing.T) {
	for _, tc := range []struct {
		name, module, source string
		want                 int
	}{
		{"type import", "M", "import type { M as Foreign } from M\nexport type Shape = Foreign\n", 0},
		{"value import", "M", "import { M as value } from M\nexport const result = value\n", 0},
		{"value reexport", "M", "export { M as value } from M\n", 0},
		{"type reexport", "M", "export type { M as Value } from M\n", 0},
		{"namespace export", "M", "export * as M from './missing.js'\n", 0},
		{"binding key", "M", "const { M: value } = { M: 1 }\nexport const result = value\n", 0},
		{"label", "M", "M: { break M }\n", 0},
		{"attribute", "M", "import './missing.js' with { M: 'custom' }\n", 0},
		{"import metadata", "meta", "export const value = import.meta\n", 0},
		{"new target", "target", "export function f() { return new.target }\n", 0},
		{"value", "M", "export const value = M\n", 1},
		{"shorthand", "M", "export const value = { M }\n", 1},
		{"type query", "M", "export type Value = typeof M\n", 1},
		{"default export", "M", "export default M\n", 1},
		{"local export", "M", "export { M }\n", 1},
		{"aliased local export", "M", "export { M as value }\n", 1},
		{"local type export", "M", "export type { M as Value }\n", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "module " + tc.module + " { export interface M { readonly value: number }; export const M = 2 }\n" + tc.source
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 4004 {
					count++
				}
			}
			if count != tc.want {
				t.Errorf("EK4004 count = %d, want %d", count, tc.want)
			}
		})
	}
}
