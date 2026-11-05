package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-1/detail75: a Function receiver retains the constructor restriction
// through intersections, inherited interfaces and generic constraints.
func TestLegacyStructuralFunctionConstructor(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"constructor-fn-intersection", `const f = (() => 1) as Function & { tag?: number }; return f.constructor`, 1},
		{"constructor-fn-alias", `type Tagged = Function & { tag?: number }; const f = (() => 1) as Tagged; return f["constructor"]`, 1},
		{"constructor-fn-interface", `interface Callable extends Function { tag?: number }; const f = (() => 1) as Callable; return f.constructor`, 1},
		{"constructor-fn-generic", `function read<T extends Function>(f: T) { return f.constructor }; return read`, 1},
		{"constructor-fn-generic-intersection", `function read<T extends Function & { tag?: number }>(f: T) { return f["constructor"] }; return read`, 1},
		{"constructor-fn-generic-interface", `interface Callable extends Function { tag?: number }; function read<T extends Callable>(f: T) { return f.constructor }; return read`, 1},
		{"constructor-fn-nullable-intersection", `const f = null as (Function & { tag?: number }) | null; return f?.constructor`, 1},
		{"constructor-fn-nullable-interface", `interface Callable extends Function { tag?: number }; const f = undefined as Callable | undefined; return f?.["constructor"]`, 1},
		{"constructor-fn-union", `interface Left extends Function { left: 1 }; interface Right extends Function { right: 2 }; const f = (() => 1) as unknown as Left | Right; return f.constructor`, 1},
		{"constructor-fn-member", `const o = {} as { f: Function & { tag?: number } }; return o.f.constructor`, 1},
		{"constructor-fn-object-control", `const o = { bind: 1, constructor: 2 }; return o.constructor`, 0},
		{"constructor-fn-any-control", `const f = (() => 1) as any; return f.constructor`, 0},
		{"constructor-fn-write-control", `const f = (() => 1) as Function & { tag?: number }; f.constructor = () => 2; return f`, 0},
		{"constructor-fn-delete-control", `const f = (() => 1) as Function & { tag?: number }; return delete (f as Partial<Function>).constructor`, 0},
		{"constructor-fn-mixed-control", `const f = {} as Function | { constructor: number }; return f.constructor`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export function load(): unknown { "+tc.body+" }")
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
					continue
				}
				if d.Category() == diagnostics.CategoryError && !(tc.name == "constructor-fn-delete-control" && d.Source() != "EK" && d.Code() == 2790) {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count=%d, want %d: %s", count, tc.want, tc.body)
			}
		})
	}
}
