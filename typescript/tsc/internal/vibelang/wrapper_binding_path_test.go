package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestWrapperBindingPathIdentity(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, row := range []struct {
			name, binding string
			reject        bool
		}{
			{"direct", "const {API:wrap}=Original", false},
			{"direct-default", "const {API:wrap=Original.API}=Original", false},
			{"nested", "const {box:{API:wrap}}={box:Original}", false},
			{"deep", "const {one:{two:{API:wrap}}}={one:{two:Original}}", false},
			{"computed", "const {['box']:{['API']:wrap}}={box:Original}", false},
			{"array", "const [wrap]=[Original.API]", false},
			{"array-hole", "const [,wrap]=[0,Original.API]", false},
			{"array-hole-fixed", "const [,wrap]=[0,Original.API] as const", false},
			{"nested-array", "const [[wrap]]=[[Original.API]]", false},
			{"object-array", "const {items:[wrap]}={items:[Original.API]}", false},
			{"array-object", "const [{API:wrap}]=[Original]", false},
			{"written", "const {box:{API:wrap}}:{box:typeof Original}={box:Original}", false},
			{"asserted", "const {box:{API:wrap}}=({box:Original} as {box:typeof Original})", false},
			{"fake", "const {box:{API:wrap}}={box:Fake}", true},
			{"mixed", "const {box:{API:wrap}}={box:flag?Fake:Original}", true},
			{"array-mixed", "const [wrap]=[flag?Fake.API:Original.API]", true},
		} {
			for _, input := range []string{"thunk", "options"} {
				t.Run(fmt.Sprintf("%s/%s/%s", api, row.name, input), func(t *testing.T) {
					expr := "risky()"
					if api == "tryPromise" {
						expr = "Promise.resolve(" + expr + ")"
					}
					callback := "()=>" + expr
					if input == "options" {
						callback = "{try:" + callback + ",catch:(error:unknown)=>error}"
					}
					source := "import {Effect as Original} from \"effect\"\nimport {Fake,risky} from \"./foreign.js\"\ndeclare const flag:boolean\n" + strings.ReplaceAll(row.binding, "API", api) + "\nexport const value=wrap(" + callback + ")"
					lib := "/** @throws {RangeError} */\nexport declare function risky():number\ntype Input<T>=(()=>T)|{try:()=>T;catch:(error:unknown)=>unknown}\nexport declare const Fake:{try(input:Input<number>):number;tryPromise(input:Input<Promise<number>>):Promise<number>}\n"
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": lib})
					want := 0
					if row.reject {
						want = 1
					}
					got := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						got++
						if want == 0 || d.Source() != diagnosticSource || d.Code() != 401 {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					if got != want {
						t.Errorf("got %d errors, want %d EK0401", got, want)
					}
				})
			}
		}
	}
}
