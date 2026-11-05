package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

func TestCallbackSatisfiesNeighbourhood(t *testing.T) {
	const lib = `/** @throws {RangeError} */
export declare function risky(n:number):number
/** @throws {never} */
export declare function safe(n:number):number
export interface Pure {
/** @throws {never} */
(n:number):number
}
export interface Admitting {
/** @throws {unknown} */
(n:number):number
}
export interface Narrow {
/** @throws {RangeError} */
(n:number):number
}
export declare const flag:boolean
`
	for _, row := range []struct {
		key, source string
		codes       []int32
	}{
		{"conditional-risk-first", "const checked=(flag ? risky : safe) satisfies Pure", []int32{402}},
		{"conditional-risk-last", "const checked=(flag ? safe : risky) satisfies Pure", []int32{402}},
		{"conditional-safe", "const checked=(flag ? safe : safe) satisfies Pure", nil},
		{"conditional-admitting", "const checked=(flag ? risky : safe) satisfies Admitting", nil},
		{"chained-bound", "const checked=risky satisfies Narrow satisfies Pure", []int32{402}},
		{"chained-admitting", "const checked=risky satisfies Narrow satisfies Admitting", nil},
		{"chained-outer", "const checked:Pure=risky satisfies Narrow satisfies Admitting", []int32{402}},
		{"asserted-pure", "const checked=(risky as Pure) satisfies Pure", nil},
		{"asserted-risk", "const checked=(safe as Narrow) satisfies Pure", []int32{402}},
		{"native-shape", "const checked=risky satisfies ((n:string)=>number)", []int32{402, 1360}},
	} {
		t.Run(row.key, func(t *testing.T) {
			source := "import {risky,safe,flag} from './lib.js'\nimport type {Pure,Admitting,Narrow} from './lib.js'\n" + row.source
			program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.d.ts": lib})
			var codes []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			slices.Sort(codes)
			if len(codes) != len(row.codes) {
				t.Fatalf("got %v, want %v", codes, row.codes)
			}
			for i, code := range codes {
				if code != row.codes[i] {
					t.Fatalf("got %v, want %v", codes, row.codes)
				}
			}
		})
	}
}
