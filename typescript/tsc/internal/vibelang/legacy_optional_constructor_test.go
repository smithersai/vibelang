package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-1: constructor reads on function values are EK0107. Optional access
// removes nullish receiver values before reading the function's property.
func TestLegacyOptionalFunctionConstructor(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"constructor-nullable-call", `const f = undefined as (() => number) | undefined; return f?.constructor`, 1},
		{"constructor-nullable-function", `const f = null as Function | null; return f?.constructor`, 1},
		{"constructor-nullable-construct", `const f = undefined as (new () => object) | undefined; return f?.["constructor"]`, 1},
		{"constructor-nullable-key-wrapper", `const f = null as (() => number) | null; return f?.[("constructor" as const)]`, 1},
		{"constructor-nullable-template-key", "const f = undefined as (() => number) | null | undefined; return f?.[`constructor`]", 1},
		{"constructor-nullable-member", `const o = {} as { f?: () => number }; return o.f?.constructor`, 1},
		{"constructor-nullable-continuation", `const o = undefined as { f: () => number } | undefined; return o?.f.constructor`, 1},
		{"constructor-nullable-generic", `function read<T extends (() => number) | undefined>(f: T) { return f?.constructor }; return read`, 1},
		{"constructor-nullable-object-control", `const o = undefined as { constructor: number } | undefined; return o?.constructor`, 0},
		{"constructor-nullable-any-control", `const o = undefined as any; return o?.constructor`, 0},
		{"constructor-nullable-instance-control", `class Box {}; const o = null as Box | null; return o?.constructor`, 0},
		{"constructor-nullable-delete-control", `const f = undefined as (() => number) | undefined; return delete f?.constructor`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export function load(): unknown { "+tc.body+" }")
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
					continue
				}
				if tc.name != "constructor-nullable-delete-control" && d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count=%d, want %d: %s", count, tc.want, tc.body)
			}
		})
	}
}
