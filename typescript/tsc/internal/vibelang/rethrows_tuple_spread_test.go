package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestRethrowsTupleSpread(t *testing.T) {
	for _, risky := range []bool{false, true} {
		for _, plain := range []bool{false, true} {
			cb := "safe"
			if risky {
				cb = "risky"
			}
			for _, shape := range []struct{ key, prefix, call string }{
				{"direct", "", "invoke(" + cb + ")"},
				{"literal", "", "invoke(...[" + cb + "] as const)"},
				{"stored", "const callbacks=[" + cb + "] as const;", "invoke(...callbacks)"},
				{"mutable", "const callbacks:[typeof " + cb + "]=[" + cb + "];", "invoke(...callbacks)"},
				{"rest", "", "many(...[safe," + cb + "] as const)"},
				{"leading", "", "after(...[1] as const," + cb + ")"},
				{"leading-two", "", "afterTwo(...[1,2] as const," + cb + ")"},
				{"trailing", "", "after(...[1," + cb + "] as const)"},
				{"split", "", "after(...[1] as const,...[" + cb + "] as const)"},
				{"nested", "", "invoke(...[...[" + cb + "] as const] as const)"},
				{"constructor", "", "new Invoke(...[" + cb + "] as const)"},
			} {
				t.Run(fmt.Sprintf("%s/risky=%t/plain=%t", shape.key, risky, plain), func(t *testing.T) {
					lib := "/** @throws {RangeError} */\nexport declare function risky(n:number):number\n/** @throws {never} */\nexport declare function safe(n:number):number\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function invoke(cb:(n:number)=>number):number\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function after(prefix:number,cb:(n:number)=>number):number\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function afterTwo(first:number,second:number,cb:(n:number)=>number):number\n" +
						"/** @throws {never}\n * @rethrows callbacks\n */\nexport declare function many(...callbacks:((n:number)=>number)[]):number\n" +
						"export declare class Invoke {\n/** @throws {never}\n * @rethrows cb\n */\nconstructor(cb:(n:number)=>number)\n}\n"
					effect := "effect "
					code := int32(403)
					if plain {
						effect = ""
						code = 401
					}
					source := "import {safe,risky,invoke,after,afterTwo,many,Invoke} from './lib.js';export " + effect + "function probe(){" + shape.prefix + "return " + shape.call + "}"
					p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
					errors := 0
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						errors++
						if !risky || d.Code() != code || d.Source() != diagnosticSource {
							t.Errorf("unexpected %s", d.String())
						}
					}
					want := 0
					if risky {
						want = 1
					}
					if errors != want {
						t.Errorf("got %d errors,want %d", errors, want)
					}
				})
			}
		}
	}
}
