package vibelang

import (
	"strings"
	"testing"
)

func TestQuickFixKeepsReturnedEffectData(t *testing.T) {
	for _, source := range []string{
		"effect function main(job: Effect.Effect<number>) { try Effect.succeed(0); return job }",
		"effect function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { try Effect.succeed(0); return flag ? a : b }",
		"effect function main(flag: boolean, job: Effect.Effect<number>) { return flag ? job : try Effect.succeed(1) }",
		"effect function main(job: Effect.Effect<number>): unknown!! { return job }",
		"effect function main(job: () => number!!): unknown!! { return job }",
		"effect function main(n: number | undefined, job: Effect.Effect<number>) { try Effect.succeed(0); return n ?? job }",
		"export effect function main() { return Effect.succeed(7) }",
		"export effect function main() { return Effect.sync(() => 7) }",
		"export const main = effect () => Effect.succeed(7)",
		"export effect function main(): unknown!! { return Effect.succeed(7) }",
		"export effect function main(flag = true) { return flag ? Effect.succeed(7) : Effect.succeed(8) }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 4802 {
					found = true
				}
			}
			if !found {
				t.Fatal("the held-return witness has no EK4802")
			}
			if got := fileFixes(t.Context(), program, file, nil, []int32{4802}).text(); got != source {
				t.Fatalf("repair runs or replaces the returned Effect data:\n%s", got)
			}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 4802 && !strings.Contains(notesOf(d), "No automatic fix") {
					t.Fatal("refusal needs an explanation")
				}
			}
		})
	}
}
