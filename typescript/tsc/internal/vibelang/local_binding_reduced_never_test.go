package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// An inferred const alias retains the same reduced never contract as its source.
func TestLocalBindingThrowsReducedNever(t *testing.T) {
	for _, bound := range []struct{ key, text string }{
		{"alias", "Quiet"}, {"parenthesized", "(Quiet)"}, {"union", "Quiet | never"}, {"conditional", "Extract<string,number>"},
	} {
		for _, builtin := range []struct{ key, signature, args string }{{"parse", "JSON.parse", "s"}, {"max", "Math.max", "1,2"}} {
			for _, chain := range []bool{false, true} {
				for _, plain := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/chain=%t/plain=%t", bound.key, builtin.key, chain, plain), func(t *testing.T) {
						lib := "type Quiet=never;\n/** @throws {" + bound.text + "} */\nexport declare const read:typeof " + builtin.signature
						bindings := "const again=read;"
						if chain {
							bindings = "const first=read;const again=first;"
						}
						effect := "effect "
						if plain {
							effect = ""
						}
						source := "import {read} from './lib.js';export " + effect + "function probe(s:string){" + bindings + "return again(" + builtin.args + ")}"
						program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Errorf("unexpected diagnostic: %s", d.String())
							}
						}
					})
				}
			}
		}
	}
}
