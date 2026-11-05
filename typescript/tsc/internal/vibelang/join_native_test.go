package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestJoinNativeIdentity(t *testing.T) {
	for _, typ := range []string{"Fiber.Fiber<number,string>", "Fiber.Fiber<number>", "Fiber.Fiber<unknown,unknown>"} {
		for _, operand := range []string{"input", "(input)", "identity(input)"} {
			t.Run(fmt.Sprintf("%s/%s", typ, operand), func(t *testing.T) {
				source := "import {Effect,Fiber} from \"effect\";const identity=<T>(x:T):T=>x;" +
					"export function native(input:" + typ + "){return Effect.gen(function*(){return yield* Fiber.join(" + operand + ")})}" +
					"export effect function actual(input:" + typ + "){return join " + operand + "}" +
					"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
				program, file, _, _ := editorProgram(t, source)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("unexpected %s\n%s", d.String(), source)
					}
				}
			})
		}
	}
}
