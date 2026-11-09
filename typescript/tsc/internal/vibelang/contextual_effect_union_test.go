package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestContextualEffectReturnUnion(t *testing.T) {
	const source = `import * as Effect from "effect/Effect"
type Plugin = {
 api: {registerProducer: (props: {queueName: string}) => Effect.Effect<{name: string}>}
 start?: (ports: Record<string, number>) => Effect.Effect<void>
}
const consume = (_builder: Plugin | Effect.Effect<Plugin>): Effect.Effect<void> => Effect.void
consume(effect {
 return {
  api: {registerProducer: (props) => Effect.succeed({name: props.queueName})},
  start: (ports) => Effect.sync(() => {const port: number = ports.worker; void port})
 }
})
`
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("%s", d.String())
		}
	}
}
