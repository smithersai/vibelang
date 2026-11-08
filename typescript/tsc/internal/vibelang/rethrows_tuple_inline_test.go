package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestRethrowsTupleInlineCallbacks(t *testing.T) {
	const lib = `/** @throws {never}
 * @rethrows cb
 */
export declare function higher(cb:()=>number):number
/** @throws {never}
 * @rethrows cb
 */
export declare function after(prefix:number,cb:()=>number):number
/** @throws {never}
 * @rethrows callbacks
 */
export declare function many(...callbacks:(()=>number)[]):number
export declare class Runner{
/** @throws {never}
 * @rethrows cb
 */
constructor(cb:()=>number)
}
`
	for _, ext := range []string{"ts", "d.ts"} {
		for _, call := range []string{
			"higher(...[()=>JSON.parse(text)] as const)",
			"higher(...([()=>JSON.parse(text)] as const))",
			"higher(...[...[()=>JSON.parse(text)] as const] as const)",
			"after(...[1,()=>JSON.parse(text)] as const)",
			"after(...[1] as const,...[()=>JSON.parse(text)] as const)",
			"many(...[()=>0,()=>JSON.parse(text)] as const)",
			"new Runner(...[()=>JSON.parse(text)] as const)",
			"after(...prefix,...[()=>JSON.parse(text)] as const)",
			"after(...[...prefix,()=>JSON.parse(text)] as const)",
		} {
			for _, context := range []string{"plain", "caught", "effect", "wrapped"} {
				t.Run(ext+"/"+call+"/"+context, func(t *testing.T) {
					host, prefix, suffix, code := "", "return ", "", int32(401)
					switch context {
					case "caught":
						prefix, suffix, code = "try{return ", "}catch{return 0}", 0
					case "effect":
						host, code = "effect ", 403
					case "wrapped":
						host, prefix, suffix, code = "effect ", "return try Effect.try(()=>", ")", 0
					}
					sourcePrefix := ""
					if strings.Contains(call, "prefix") {
						sourcePrefix = "const prefix=[1] as const;"
					}
					source := "import{higher,after,many,Runner}from'./lib.js';export " + host + "function probe(text:string){" + sourcePrefix + prefix + call + suffix + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
					start := strings.Index(file.Text(), call)
					if strings.HasPrefix(call, "new ") {
						start += 4
					}
					var got []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						got = append(got, d.Code())
						if code != 0 && d.Pos() > start {
							t.Errorf("diagnostic is inside the callback, not its invocation: %s", d.String())
						}
					}
					want := 0
					if code != 0 {
						want = 1
					}
					if len(got) != want || want == 1 && got[0] != code {
						t.Fatalf("got %v; want %d instances of %d", got, want, code)
					}
				})
			}
		}
	}
}
