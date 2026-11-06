package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestJoinNativeUncheckedIdentity(t *testing.T) {
	for _, row := range []struct{ key, generic, typ string }{
		{"any", "", "any"}, {"never", "", "never"},
		{"any-alias", "", "Unchecked"}, {"never-alias", "", "Empty"},
		{"any-union", "", "any|undefined"}, {"never-intersection", "", "number&never"},
		{"never-generic", "<T extends never>", "T"},
	} {
		for _, operand := range []string{"input", "(input)", "identity(input)", "(input satisfies Fiber.Fiber<any,any>)"} {
			t.Run(fmt.Sprintf("%s/%s", row.key, operand), func(t *testing.T) {
				source := "import {Effect,Fiber} from \"effect\";type Unchecked=any;type Empty=never;const identity=<T>(x:T):T=>x;" +
					"export function native" + row.generic + "(input:" + row.typ + "){return Effect.gen(function*(){return yield* Fiber.join(" + operand + ")})}" +
					"export effect function actual" + row.generic + "(input:" + row.typ + "){return join " + operand + "}" +
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
