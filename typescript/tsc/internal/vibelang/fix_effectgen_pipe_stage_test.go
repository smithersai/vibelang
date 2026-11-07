package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A pipe's stage that a foreign call builds runs where the pipe stands, so
// EK1002's rewrite writes it through the defect bridge like any other throwing
// call. It used to pass over pipe stages, and the rewrite reported EK0403
// (opencode's server handlers: effect.pipe(instances.provide(session), …)).
func TestEffectGenDefectBridgeCoversPipeStages(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	const bridged = "try Effect.orDie(Effect.try({ try: () => provide(s), catch: (e) => e }))"
	for name, tc := range map[string]struct{ head, body, want string }{
		"the only stage":       {"(e: Effect.Effect<number>, s: string) =>", "return yield* e.pipe(provide(s))", bridged},
		"before a custom one":  {"(s: string) => (e: Effect.Effect<number>) =>", "return yield* e.pipe(provide(s), mapErrors)", bridged},
		"after a standard one": {"(e: Effect.Effect<number>, s: string) =>", "return yield* e.pipe(Effect.map((n) => n + 1), provide(s))", "provide(s), catch: (e) => e }))"},
		"a method stage":       {"(e: Effect.Effect<number>, s: string) =>", "return yield* e.pipe(stages.provide(s), mapErrors)", "try: () => stages.provide(s), catch: (e) => e"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
			stage := "import { Effect } from \"effect\"\n" +
				"export const provide = (s: string) => <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => { if (s === \"bad\") throw new Error(s); return self }\n" +
				"export const stages = { provide }\n"
			if err := os.WriteFile(filepath.Join(dir, "stage.ts"), []byte(stage), 0o644); err != nil {
				t.Fatal(err)
			}
			source := "import { provide, stages } from \"./stage.ts\"\nconst mapErrors = <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.orDie(self)\nexport const value = " + tc.head + " Effect.gen(function* () {\n  " + tc.body + "\n})\n"
			if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0o644); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			for _, refusal := range result.Refused {
				if refusal.Code == EK1002.Code || strings.Contains(refusal.Error, "EK0403") {
					t.Errorf("refused: %+v", refusal)
				}
			}
			got := ""
			for file, fixed := range result.Files {
				if filepath.Base(file.AsString()) == "lib.vibe" {
					got = fixed.Text
				}
			}
			if strings.Contains(got, "function*") || !strings.Contains(got, tc.want) {
				t.Errorf("--fix writes\n%s\nwant it to hold\n%s", got, tc.want)
			}
		})
	}
}
