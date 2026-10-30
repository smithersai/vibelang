package vibelang

import "testing"

func TestEffectEditsProgramConversions(t *testing.T) {
	for _, tt := range []struct{ name, source, want string }{
		{"by-name parameter", `export function main(job: () => number!!) { return try Effect.retry(job, { times: 1 }) }`, `import * as $effectPrograms from "effect/Effect"
export effect function main(job: () => number!!) { return try Effect.retry($effectPrograms.suspend(job), { times: 1 }) }`},
		{"by-name arithmetic", `effect function load() { try yieldNow(); return 1 } export function main() { return try Effect.retry(load() + 1, { times: 1 }) }`, `effect function load() { try yieldNow(); return 1 } export effect function main() { return try Effect.retry(effect { return (try load() + 1) }, { times: 1 }) }`},
		{"by-name pipe", `effect function load() { try yieldNow(); return 1 } export function main() { return load() + 1 |> try Effect.retry(%, { times: 1 }) }`, `effect function load() { try yieldNow(); return 1 } export effect function main() { return effect { return (try load() + 1) } |> try Effect.retry(%, { times: 1 }) }`},
		{"shorthand program", `export effect function main(job: () => number!!) { const service: { job: number!! } = { job }; return try service.job() }`, `import * as $effectPrograms from "effect/Effect"
export effect function main(job: () => number!!) { const service: { job: number!! } = { job: $effectPrograms.suspend(job) }; return try service.job() }`},
		{"effect pipe result", `export effect function main() { return try Effect.orDie(Effect.succeed(Exit.succeed(9)) |> Effect.tap(%, effect () => try Effect.sleep("1 millis"))) }`, `export effect function main() { return try Effect.orDie(Effect.succeed(Exit.succeed(9)) |> Effect.tap(%, effect () => try Effect.sleep("1 millis"))) }`},
		{"fork callback", `export function main() { const f = fork { try yieldNow(); return 1 }; return join f }`, `export effect function main() { const f = fork effect { try yieldNow(); return 1 }; return join f }`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tt.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				t.Errorf("source diagnostic: %s", d.String())
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			edits, _ := effectEdits(c, file)
			if got := applyEdits(tt.source, mergeInsertions(edits)); got != tt.want {
				t.Fatalf("got %s\nwant %s", got, tt.want)
			}
			done()
			again, fixed, _, _ := editorProgram(t, tt.want)
			for _, d := range again.GetSemanticDiagnostics(t.Context(), fixed) {
				t.Errorf("rewritten diagnostic: %s", d.String())
			}
			c2, release := again.GetTypeCheckerForFile(t.Context(), fixed)
			defer release()
			if edits, _ := effectEdits(c2, fixed); len(edits) != 0 {
				t.Errorf("second migration edits: %+v", edits)
			}
		})
	}
}
