package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestObjectThrowsContract(t *testing.T) {
	for _, row := range []struct {
		name, source, target string
		admitted             bool
	}{
		{"primitive", "string", "{readonly code:string}", false},
		{"wrong-property", "{readonly code:number}", "{readonly code:string}", false},
		{"literal-property", "{readonly code:\"E\"}", "{readonly code:string}", true},
		{"nested-wrong", "{readonly nested:{readonly code:number}}", "{readonly nested:{readonly code:string}}", false},
		{"nested-right", "{readonly nested:{readonly code:\"E\"}}", "{readonly nested:{readonly code:string}}", true},
		{"index-wrong", "{readonly count:string}", "{readonly [key:string]:number}", false},
		{"index-right", "{readonly count:number}", "{readonly [key:string]:number}", true},
		{"function-wrong", "(x:number)=>string", "(x:string)=>number", false},
		{"function-right", "(x:string)=>number", "(x:string)=>number", true},
		{"tuple-wrong", "[number,string]", "[string,number]", false},
		{"tuple-right", "[string,number]", "[string,number]", true},
		{"optional-missing", "{}", "{readonly code?:string}", true},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			for _, spelling := range []string{"inline", "named"} {
				t.Run(fmt.Sprintf("%s/%s/%s", row.name, ext, spelling), func(t *testing.T) {
					src, dst := row.source, row.target
					if spelling == "named" {
						src, dst = "Given", "Wanted"
					}
					lib := fmt.Sprintf("export type Given=%s\nexport type Wanted=%s\n/** @throws {%s} */\nexport declare function risky():number\nexport type Target={\n/** @throws {%s} */\n():number\n}\n", row.source, row.target, src, dst)
					p, f, _, _ := requirementIdentityProgram(t, "import{risky,Target}from\"./lib.js\"\nexport const selected:Target=risky", map[string]string{"lib." + ext: lib})
					var codes []int32
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() == diagnostics.CategoryError {
							if d.Source() != diagnosticSource || d.Code() != 402 {
								t.Errorf("unexpected %s", d.String())
							}
							codes = append(codes, d.Code())
						}
					}
					want := 1
					if row.admitted {
						want = 0
					}
					if len(codes) != want {
						t.Errorf("codes=%v want %d EK0402", codes, want)
					}
				})
			}
		}
	}
}
