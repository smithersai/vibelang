package vibelang

import (
	"testing"
)

func TestGlobalLegacyMembers(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         int
	}{
		{"eval-dot", "export const value = globalThis.eval", 1},
		{"eval-string", "export const value = globalThis[\"eval\"]", 1},
		{"eval-template", "export const value = globalThis[`eval`]", 1},
		{"eval-optional", "export const value = globalThis?.eval", 1},
		{"function-dot", "export const value = globalThis.Function", 1},
		{"local-function-name", "const Function = () => 0; export const value = globalThis.Function", 1},
		{"function-string", "export const value = globalThis[\"Function\"]", 1},
		{"function-template", "export const value = globalThis[`Function`]", 1},
		{"function-optional", "export const value = globalThis?.[\"Function\"]", 1},
		{"repeated-global", "export const value = globalThis[\"globalThis\"].Function", 1},
		{"runtime-typeof", "export const value = typeof globalThis.Function", 1},
		{"prototype-dot", "export const value = globalThis.Function.prototype", 0},
		{"prototype-bracket", "export const value = globalThis[\"Function\"][`prototype`]", 0},
		{"prototype-optional", "export const value = globalThis.Function?.prototype", 0},
		{"instanceof", "export const value = (() => 1) instanceof (globalThis[\"Function\"])", 0},
		{"type-query", "export type Value = typeof globalThis.Function", 0},
		{"local-shadow", "const globalThis = {eval: () => 1, Function: () => 2}; export const value = [globalThis.eval, globalThis.Function]", 0},
		{"parameter-shadow", "export function value(globalThis: {eval: () => number; Function: () => number}) { return [globalThis.eval,globalThis.Function] }", 0},
		{"module-body", "module Native { export const value = globalThis.eval; export const constructor = globalThis.Function }\nexport {}", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, test.source)
			n := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Source() == "EK" && d.Code() == EK0107.Code {
					n++
				}
			}
			if n != test.want {
				t.Fatalf("got %d EK0107, want %d\n%s", n, test.want, test.source)
			}
		})
	}
}
