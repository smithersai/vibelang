package vibelang

import (
	"strings"
	"testing"
)

// Chapter 900: EK4801 discarded Effect diagnostic - rule-evidence: docs/design/src/900-appendices.md#aea235e216916daa
func TestQuickFixKeepsDiscardedEffectCold(t *testing.T) {
	for _, source := range []string{
		"effect function main(job: Effect.Effect<number>) { job }",
		"effect function main(job: Effect.Effect<number>) { (job) }",
		"effect function main(jobs: {first: Effect.Effect<number>}) { jobs.first }",
		"effect function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { flag ? a : b }",
		"export effect function main() { Effect.succeed(7) }",
		"export effect function main() { Effect.sync(() => 7) }",
		"export effect function main() { try Console.log(\"before\"); interrupt }",
	} {
		for _, crlf := range []bool{false, true} {
			s := "// @vibelang-diagnostics EK4801:warning\n// café 😀\n" + source
			if crlf {
				s = strings.ReplaceAll(s, "\n", "\r\n")
			}
			t.Run(s, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, s)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == "EK" && d.Code() == 4801 {
						found = true
						if !strings.Contains(notesOf(d), "No automatic fix") {
							t.Error("refusal needs an explanation")
						}
					}
				}
				if !found {
					t.Fatal("cold witness has no EK4801")
				}
				if got := fileFixes(t.Context(), program, file, nil, []int32{4801}).text(); got != s {
					t.Fatalf("repair ran a discarded cold program:\n%s", got)
				}
			})
		}
	}
}
