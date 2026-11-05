package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCallbackSatisfiesContracts(t *testing.T) {
	const lib = `/** @throws {RangeError} */
export declare function risky(n:number):number
/** @throws {never} */
export declare function safe(n:number):number
export interface Pure {
/** @throws {never} */
(n:number):number}
export interface Admitting {
/** @throws {RangeError} */
(n:number):number}
/** @throws {never} */
export declare function accepts(cb:Pure):number
/** @throws {never}
 * @rethrows cb
 */
export declare function invoke(cb:(n:number)=>number):number
/** @throws {never} */
export declare function make():Admitting
export declare function untagged(n:number):number
export declare const untypedValue:(n:number)=>number
/** @throws {never} */
export declare function untypedFactory():(n:number)=>number
export declare const holder:{read:typeof risky}
export declare class Accessor {get read():typeof risky}
export declare const accessor:Accessor
`
	for _, ext := range []string{"ts", "d.ts"} {
		for _, row := range []struct {
			key, source string
			codes       []int32
		}{
			{"direct-negative", "export const checked:Pure=risky", []int32{402}},
			{"pure", "export const checked=risky satisfies Pure", []int32{402}},
			{"inline", "export const checked=risky satisfies ((n:number)=>number)", []int32{402}},
			{"admitting", "export const checked=risky satisfies Admitting", nil},
			{"safe", "export const checked=safe satisfies Pure", nil},
			{"assertion-control", "export const checked=risky as Pure", nil},
			{"argument", "export function probe(){return accepts(risky satisfies Admitting)}", []int32{402}},
			{"initializer", "export const checked:Pure=risky satisfies Admitting", []int32{402}},
			{"return", "export function probe():Pure{return risky satisfies Admitting}", []int32{402}},
			{"rethrow-plain", "export function probe(){return invoke(risky satisfies Admitting)}", []int32{401}},
			{"rethrow-effect", "export effect function probe(){return invoke(risky satisfies Admitting)}", []int32{403}},
			{"rethrow-caught", "export function probe(){try{return invoke(risky satisfies Admitting)}catch{return 0}}", nil},
			{"bound-rethrows", "export function probe(){try{return invoke(risky satisfies Pure)}catch{return 0}}", []int32{402}},
			{"property", "export const checked=holder.read satisfies Pure", []int32{402}},
			{"getter", "export const checked=accessor.read satisfies Pure", []int32{402}},
			{"asserted-admitting", "export const checked=(risky as Admitting) satisfies Pure", []int32{402}},
			{"asserted-pure", "export const checked=(risky as Pure) satisfies Pure", nil},
			{"factory-written", "export const checked=make() satisfies Pure", []int32{402}},
			{"unknown-declaration", "export const checked=untagged satisfies Pure", []int32{402}},
			{"unknown-value-policy", "export const checked=untypedValue satisfies Pure", nil},
			{"unknown-return-policy", "export const checked=untypedFactory() satisfies Pure", nil},
		} {
			t.Run(ext+"/"+row.key, func(t *testing.T) {
				source := "import {risky,safe,accepts,invoke,make,untagged,untypedValue,untypedFactory,holder,accessor} from './lib.js'\nimport type {Pure,Admitting} from './lib.js'\n" + row.source
				program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
				var codes []int32
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						codes = append(codes, d.Code())
					}
				}
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
}
