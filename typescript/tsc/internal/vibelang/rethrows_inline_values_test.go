package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestRethrowsInlineValueBranches(t *testing.T) {
	const lib = "/** @throws {never}\n * @rethrows cb\n */\nexport declare function invoke(cb:()=>number):number\n"
	for _, ext := range []string{"ts", "d.ts"} {
		for _, shape := range []string{
			"flag?(()=>JSON.parse(text)):(()=>0)",
			"flag?(()=>0):(()=>JSON.parse(text))",
			"maybe??(()=>JSON.parse(text))",
			"maybe||(()=>JSON.parse(text))",
			"(flag&&(()=>JSON.parse(text)))||(()=>0)",
			"(Math.max(1),()=>JSON.parse(text))",
			"flag?(maybe||(()=>JSON.parse(text))):(()=>0)",
		} {
			for _, context := range []string{"plain", "caught", "effect", "wrapped"} {
				t.Run(ext+"/"+shape+"/"+context, func(t *testing.T) {
					host, prefix, suffix, code := "", "return ", "", int32(401)
					switch context {
					case "caught":
						prefix, suffix, code = "try{return ", "}catch{return 0}", 0
					case "effect":
						host, code = "effect ", 403
					case "wrapped":
						host, prefix, suffix, code = "effect ", "return try Effect.try(()=>", ")", 0
					}
					source := "import{invoke}from'./lib.js';declare const maybe:(()=>number)|undefined;export " + host + "function probe(flag:boolean,text:string){" + prefix + "invoke(" + shape + ")" + suffix + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
					var got []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						got = append(got, d.Code())
						if code != 0 && !strings.Contains(file.Text()[d.Pos():d.End()], "invoke") {
							t.Errorf("diagnostic left its enclosing call: %s", d.String())
						}
					}
					want := 0
					if code != 0 {
						want = 1
					}
					if len(got) != want || want == 1 && got[0] != code {
						t.Fatalf("got %v; want %d occurrences of %d", got, want, code)
					}
				})
			}
		}
	}
}
