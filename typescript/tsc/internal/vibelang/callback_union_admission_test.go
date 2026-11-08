package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestCallbackUnionAdmission(t *testing.T) {
	for _, shape := range []struct {
		name, parameters string
		admit            bool
	}{
		{"direct", "input:Allowed", true},
		{"object-union", "input:Allowed|{label:string}", true},
		{"optional", "input:Allowed|undefined", true},
		{"optional-parameter", "input?:Allowed", true},
		{"callable-union", "input:Allowed|Denied", true},
		{"intersection", "input:Allowed&{readonly label?:string}", true},
		{"tuple", "...args:[input:Allowed|{label:string}]", true},
		{"denied-object", "input:Denied|{label:string}", false},
		{"denied-direct", "input:Denied", false},
		{"untagged-union", "input:(()=>number)|{label:string}", false},
		{"untagged-direct", "input:()=>number", false},
	} {
		for _, expr := range []string{"risky()", "JSON.parse(\"1\") as number"} {
			for _, fn := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/function=%t", shape.name, expr, fn), func(t *testing.T) {
					callback := "() => " + expr
					if fn {
						callback = "function () {return " + expr + "}"
					}
					source := "import {invoke,risky} from \"./foreign.js\"\nexport const value=invoke(" + callback + ")\n"
					library := `export type Allowed={
/** @throws {unknown} */
():number
}
export type Denied={
/** @throws {never} */
():number
}
/** @throws {RangeError} */
export declare function risky():number
export declare function invoke(` + shape.parameters + `):number
`
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
					got := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						got++
						if shape.admit || d.Source() != diagnosticSource || d.Code() != 401 {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					want := 1
					if shape.admit {
						want = 0
					}
					if got != want {
						t.Errorf("got %d errors, want %d EK0401", got, want)
					}
				})
			}
		}
	}
}
