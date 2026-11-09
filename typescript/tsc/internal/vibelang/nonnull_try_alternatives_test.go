package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestNonNullTryAlternatives(t *testing.T) {
	for _, api := range []string{"try", "tryPromise"} {
		for _, style := range []string{"direct", "nonnull", "double-nonnull", "object-nonnull"} {
			for _, contract := range []string{"admitting", "strict", "mixed", "foreign-mixed"} {
				t.Run(fmt.Sprintf("%s/%s/%s", api, style, contract), func(t *testing.T) {
					allowed := "Effect." + api + "<number>"
					denied := "Effect.sync<number>"
					foreign := "strict"
					expression := "risky()"
					if api == "tryPromise" {
						denied = "Effect.promise<number>"
						foreign = "asyncStrict"
						expression = "Promise.resolve(risky())"
					}
					value, want := allowed, 0
					switch contract {
					case "strict":
						value, want = denied, 1
					case "mixed":
						value, want = "(flag?"+denied+":"+allowed+")", 1
					case "foreign-mixed":
						value, want = "(flag?"+foreign+":"+allowed+")", 1
					}
					switch style {
					case "nonnull":
						value = "(" + value + ")!"
					case "double-nonnull":
						value = "((" + value + ")!)!"
					case "object-nonnull":
						if contract == "mixed" {
							value = "(flag?{run:" + denied + "}:{run:" + allowed + "})!.run"
						} else if contract == "foreign-mixed" {
							value = "(flag?{run:" + foreign + "}:{run:" + allowed + "})!.run"
						} else {
							value = "({run:" + value + "})!.run"
						}
					}
					source := "import {Effect} from \"effect\"\nimport {risky,flag,strict,asyncStrict} from \"./foreign.js\"\nconst bridge=" + value + "\nexport const value=bridge(()=>" + expression + ")"
					library := `import {Effect} from "effect"
export declare const flag:boolean
/** @throws {RangeError} */
export declare function risky():number
export declare function strict(callback:()=>number):Effect.Effect<number>
export declare function asyncStrict(callback:()=>PromiseLike<number>):Effect.Effect<number>
`
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": library})
					got := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						got++
						if d.Source() != diagnosticSource || d.Code() != 401 {
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
