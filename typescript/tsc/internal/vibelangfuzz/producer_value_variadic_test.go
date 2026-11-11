package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestProducerValueVariadicRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, row := range []struct{ key, api, call string }{
		{"variadic-tail", "/** @throws {never} */ export declare function take(...args:[...number[],unknown]):number;/** @throws {never} */ export declare function take(f:G):number;", "take(ARG)"},
		{"variadic-tail-prefix", "/** @throws {never} */ export declare function take(...args:[...number[],unknown]):number;/** @throws {never} */ export declare function take(prefix:number,f:G):number;", "take(1,ARG)"},
		{"variadic-prefix", "/** @throws {never} */ export declare function take(f:unknown,...args:[...number[],()=>void]):number;/** @throws {never} */ export declare function take(f:G,done:()=>void):number;", "take(ARG,()=>{})"},
		{"variadic-middle", "/** @throws {never} */ export declare function take(...args:[...number[],unknown,()=>void]):number;/** @throws {never} */ export declare function take(prefix:number,f:G,done:()=>void):number;", "take(1,ARG,()=>{})"},
		{"void-metadata", "/** @throws {never} */ export declare function take(f:unknown,unused:void):number;/** @throws {never} */ export declare function take(f:G):number;", "take(ARG)"},
		{"spread-array", "/** @throws {never} */ export declare function take(f:unknown,...meta:number[]):number;/** @throws {never} */ export declare function take(f:G,...meta:number[]):number;", "take(ARG,...[1,2])"},
		{"spread-tuple", "/** @throws {never} */ export declare function take(f:unknown,n:number):number;/** @throws {never} */ export declare function take(f:G,n:number):number;", "take(ARG,...([1] as const))"},
		{"spread-before", "/** @throws {never} */ export declare function take(n:number,f:unknown):number;/** @throws {never} */ export declare function take(n:number,f:G):number;", "take(...([1] as const),ARG)"},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			t.Run(row.key+"/"+home, func(t *testing.T) {
				source := "import {take} from \"./api.js\";"
				arg := "effect function*(){yield 1}"
				if home != "inline" {
					source += "effect function* values(){yield 1};"
					arg = "values"
					if home == "alias" {
						source += "const alias=values;"
						arg = "alias"
					}
				}
				source += "export const result=" + strings.ReplaceAll(row.call, "ARG", arg) + ";"
				r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "api.ts": "type G=()=>Generator<number,void,unknown>;" + row.api}})
				if err != nil {
					t.Fatal(err)
				}
				defer r.Remove()
				var codes []int32
				for _, d := range r.Diagnostics {
					if d.Category() == diagnostics.CategoryError {
						codes = append(codes, d.Code())
					}
				}
				if len(codes) != 0 {
					t.Fatalf("valid value call rejected: %v\n%s\n%s", codes, source, row.api)
				}
			})
		}
	}
}
