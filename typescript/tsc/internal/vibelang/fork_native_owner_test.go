package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestForkNativeOwnerIdentity(t *testing.T) {
	rows := []struct{ key, native, actual string }{
		{"argument", "const child=yield* Effect.forkChild(p);return yield* Fiber.join(identity(child))", "const child=fork p;return join identity(child)"},
		{"array", "const child=yield* Effect.forkChild(p);return yield* collect([child])", "const child=fork p;return try collect([child])"},
		{"return", "return yield* Effect.forkChild(p)", "return fork p"},
		{"closure", "const child=yield* Effect.forkChild(p);const later=()=>Fiber.join(child);return yield* later()", "const child=fork p;const later=()=>Fiber.join(child);return try later()"},
		{"block", "{const child=yield* Effect.forkChild(p);return yield* Fiber.join(child)}", "{const child=fork p;return join child}"},
		{"loop", "for(let i=0;i<1;i++){const child=yield* Effect.forkChild(p);return yield* Fiber.join(child)}", "for(let i=0;i<1;i++){const child=fork p;return join child}"},
	}
	for _, row := range rows {
		for _, programType := range []string{"Effect.Effect<number,string>", "Effect.Effect<number,string,Scope.Scope>", "Effect.Effect<number,string,R>", "any", "never", "Effect.Effect<any,unknown,unknown>"} {
			t.Run(fmt.Sprintf("%s/%s", row.key, programType), func(t *testing.T) {
				source := "import {Fiber,Scope} from \"effect\";const identity=<T>(x:T):T=>x;const collect=<A,E>(xs:ReadonlyArray<Fiber.Fiber<A,E>>)=>Effect.all(xs.map(Fiber.join));" +
					"export function native<R>(p:" + programType + "){return Effect.gen(function*(){" + row.native + "})}" +
					"export effect function actual<R>(p:" + programType + "){" + row.actual + "}" +
					"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
				program, file, _, _ := editorProgram(t, source)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("unexpected %s%d: %s\\n%s", d.Source(), d.Code(), d.MessageText(), source)
					}
				}
			})
		}
	}
}
