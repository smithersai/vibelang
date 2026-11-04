package vibelang

import (
	"strings"
	"testing"
)

// A recovered program is still a program for the following recovery stage.
// A failure created after a lookup belongs to the program caught as a whole.
func TestAlchemyCatchProgramScope(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"job chained recovery", `error Forbidden
error NotFound
effect function source(): number!Forbidden { throw new Forbidden() }
effect function fallback(): number!NotFound { throw new NotFound() }
export const list = Effect.fn(function* () {
  return yield* source().pipe(
    Effect.catchTag("Forbidden", () => fallback()),
    Effect.catchTag("NotFound", () => Effect.succeed(0)),
  )
})
`},
		{"pipe grouped failure", `error NotFound
error Present { state: string }
effect function describe(): { state: string }!NotFound { throw new NotFound() }
export effect function awaitGone() {
  return (try Effect.fail(new Present({ state: (try describe()).state }))) catch effect (e) => match (e) {
    when { _tag: "NotFound" }: undefined;
    default: throw e;
  }
}
`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, result := fixedPipe(t, tc.source)
			if strings.Contains(got, "Effect.fn") || strings.Contains(got, "Effect.catchTag") || strings.Contains(got, "return (try Effect.fail") {
				t.Fatalf("the shared converter did not finish the program:\n%s\nrefused: %+v", got, result.Refused)
			}
			if again, _ := fixedPipe(t, got); again != got {
				t.Fatalf("conversion is not idempotent:\n%s", again)
			}
			t.Logf("converted:\n%s", got)
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == 1 {
					t.Errorf("converted program reports %s", d.String())
				}
			}
		})
	}
}
