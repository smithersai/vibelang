package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestRethrowsOptionalTrailingTuple(t *testing.T) {
	const lib = `/** @throws {RangeError} */
export declare function risky(n:number):number
/** @throws {never} */
export declare function safe(n:number):number
/** @throws {never}
 * @rethrows cb
 */
export declare function invoke(cb?:((n:number)=>number)):number
/** @throws {never}
 * @rethrows cb
 */
export declare function prefixed(prefix:number,cb?:((n:number)=>number)):number
`
	for _, ext := range []string{"ts", "d.ts"} {
		for _, row := range []struct {
			key, decl, call string
			risk            bool
		}{
			{"optional-risk", "declare const args:[cb?:typeof risky]", "invoke(...args)", true},
			{"optional-safe", "declare const args:[cb?:typeof safe]", "invoke(...args)", false},
			{"readonly-risk", "declare const args:readonly[cb?:typeof risky]", "invoke(...args)", true},
			{"readonly-safe", "declare const args:readonly[cb?:typeof safe]", "invoke(...args)", false},
			{"nullable-risk", "declare const args:[cb:typeof risky|undefined]", "invoke(...args)", true},
			{"nullable-safe", "declare const args:[cb:typeof safe|undefined]", "invoke(...args)", false},
			{"prefix-risk", "declare const args:[cb?:typeof risky]", "prefixed(1,...args)", true},
			{"prefix-safe", "declare const args:[cb?:typeof safe]", "prefixed(1,...args)", false},
			{"tuple-prefix-risk", "declare const args:[prefix:number,cb?:typeof risky]", "prefixed(...args)", true},
			{"tuple-prefix-safe", "declare const args:[prefix:number,cb?:typeof safe]", "prefixed(...args)", false},
			{"required-risk", "const args=[risky] as const", "invoke(...args)", true},
			{"empty", "const args=[] as const", "invoke(...args)", false},
		} {
			for _, host := range []string{"effect", "plain", "caught"} {
				t.Run(ext+"/"+row.key+"/"+host, func(t *testing.T) {
					body := "return " + row.call
					if host == "caught" {
						body = "try{" + body + "}catch{return 0}"
					}
					modifier := ""
					if host == "effect" {
						modifier = "effect "
					}
					source := "import {risky,safe,invoke,prefixed} from './lib.js'\n" + row.decl + "\nexport " + modifier + "function read(){" + body + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
					var got []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							got = append(got, d.Code())
						}
					}
					var want []int32
					if row.risk && host != "caught" {
						code := int32(401)
						if host == "effect" {
							code = 403
						}
						want = []int32{code}
					}
					if len(got) != len(want) {
						t.Fatalf("got %v, want %v", got, want)
					}
					for i, code := range got {
						if code != want[i] {
							t.Fatalf("got %v, want %v", got, want)
						}
					}
				})
			}
		}
	}
}
