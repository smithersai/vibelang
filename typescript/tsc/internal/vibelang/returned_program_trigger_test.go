package vibelang

import "testing"

// VIP-1 keeps native plain factories; VIP-5 keeps return values unflattened.
// Own EK4802 diagnoses inferred Effect arguments, not the data returned.
func TestReturnedProgramTrigger(t *testing.T) {
	for _, source := range []string{
		"export function held() { return Effect.succeed(1) }",
		"export effect function held() { return Effect.succeed(1) }",
		"export const held = effect () => Effect.succeed(1)",
		"export const held = effect { return Effect.succeed(1) }",
		"export effect function held(): unknown!! { return Effect.succeed(1) }",
		"export effect function held(): (number!!)!! { return Effect.succeed(1) }",
		"export effect function held() { return Exit.succeed(1) }",
		"export effect function held(): unknown!! { return Exit.succeed(1) }",
		"export effect function held(): unknown!! { return effect () => 1 }",
		"export effect function held(job: () => number!!): unknown!! { return job }",
		"export effect function held(job: (number!!) | undefined): unknown!! { return job }",
		"export effect function held(flag: boolean, job: number!!) { return flag ? job : 1 }",
		"export effect function held(n: number | undefined, job: number!!) { return n ?? job }",
		"export effect function held() { return try Effect.succeed(1) }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 4802 {
					t.Fatalf("returned program is not an inferred argument: %s", d.String())
				}
			}
		})
	}
}
