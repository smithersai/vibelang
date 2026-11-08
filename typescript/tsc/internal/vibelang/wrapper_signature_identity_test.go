package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestWrapperSignatureIdentity(t *testing.T) {
	for _, binding := range []struct {
		name, imports, declaration string
		fake, param                bool
	}{
		{"implicit", "", "", false, false},
		{"named", "import {Effect} from \"effect\"\n", "", false, false},
		{"namespace", "import * as Effect from \"effect/Effect\"\n", "", false, false},
		{"alias", "import {Effect as Original} from \"effect\"\n", "const Effect=Original\n", false, false},
		{"constant", "", "const Effect={try:(cb:()=>number)=>cb(),tryPromise:(cb:()=>Promise<number>)=>cb()}\n", true, false},
		{"parameter", "", "", true, true},
		{"imported", "import {Fake as Effect} from \"./lib.js\"\n", "", true, false},
		{"admitting", "import {Admitting as Effect} from \"./lib.js\"\n", "", false, false},
		{"forbidding", "import {Forbidding as Effect} from \"./lib.js\"\n", "", true, false},
	} {
		for _, api := range []string{"try", "tryPromise"} {
			for _, operand := range []string{"risky()", "JSON.parse(\"1\") as number"} {
				t.Run(fmt.Sprintf("%s/%s/%s", binding.name, api, operand), func(t *testing.T) {
					expr := operand
					if api == "tryPromise" {
						expr = "Promise.resolve(" + operand + ")"
					}
					call := "Effect." + api + "(() => " + expr + ")"
					body := "export const probe=" + call + "\n"
					if binding.param {
						body = "export function probe(Effect:{try(cb:()=>number):number;tryPromise(cb:()=>Promise<number>):Promise<number>}){return " + call + "}\n"
					}
					source := "import {risky} from \"./lib.js\"\n" + binding.imports + binding.declaration + body
					lib := `/** @throws {RangeError} */
export declare function risky():number
export declare const Fake:{try(cb:()=>number):number;tryPromise(cb:()=>Promise<number>):Promise<number>}
export type Allowed={
/** @throws {unknown} */
():number
}
export type AsyncAllowed={
/** @throws {unknown} */
():Promise<number>
}
export declare const Admitting:{try(cb:Allowed):number;tryPromise(cb:AsyncAllowed):Promise<number>}
export type Forbidden={
/** @throws {never} */
():number
}
export type AsyncForbidden={
/** @throws {never} */
():Promise<number>
}
export declare const Forbidding:{try(cb:Forbidden):number;tryPromise(cb:AsyncForbidden):Promise<number>}

`
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.d.ts": lib})
					n := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						n++
						if !binding.fake || d.Source() != diagnosticSource || d.Code() != 401 {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					want := 0
					if binding.fake {
						want = 1
					}
					if n != want {
						t.Errorf("got %d errors, want %d EK0401", n, want)
					}
				})
			}
		}
	}
}
