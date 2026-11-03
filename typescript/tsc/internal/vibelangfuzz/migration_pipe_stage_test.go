package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationPipeStageTarget = "FuzzMigrationPipeStage"
const migrationPipeStageQuote = "`vibelang --fix` keeps the existing safe-fix checks and refusal rules."

// A .pipe stage migrates to |>, and only a stage whose first data-first
// parameter is the piped value takes it as %, first. Effect's Semaphore
// functions name the Semaphore self and take the program last, and --fix wrote
// Semaphore.withPermits(%, semaphore, 1): Smithers' Outbox kept its generator,
// EK1002 and an any that surfaced as TS2375. The oracle compares the fixed
// module with the same source as .ts.
const migrationPipeStagePrelude = `import { Effect, Option, Stream } from "effect"
import * as Semaphore from "effect/Semaphore"
const p = Effect.succeed(1)
`

var migrationPipeStagePrograms = []struct{ key, source string }{
	{"semaphore-permits", "export const main = () => Effect.gen(function* () {\n  const s = yield* Semaphore.make(1)\n  return yield* p.pipe(Semaphore.withPermits(s, 1))\n})\n"},
	{"semaphore-permit", "export const main = () => Effect.gen(function* () {\n  const s = yield* Semaphore.make(1)\n  return yield* p.pipe(Semaphore.withPermit(s))\n})\n"},
	{"semaphore-available", "export const main = () => Effect.gen(function* () {\n  const s = yield* Semaphore.make(1)\n  return yield* p.pipe(Semaphore.withPermitsIfAvailable(s, 1), Effect.map(Option.isSome))\n})\n"},
	{"semaphore-then-map", "export const main = () => Effect.gen(function* () {\n  const s = yield* Semaphore.make(1)\n  return yield* p.pipe(Semaphore.withPermits(s, 1), Effect.map((x) => x + 1))\n})\n"},
	{"dual-map", "export const main = () => Effect.gen(function* () {\n  return yield* p.pipe(Effect.map((x) => x + 1))\n})\n"},
	{"dual-zip", "export const main = () => Effect.gen(function* () {\n  return yield* p.pipe(Effect.zip(p))\n})\n"},
	{"dual-as", "export const main = () => Effect.gen(function* () {\n  return yield* p.pipe(Effect.as(2))\n})\n"},
	{"dual-stream", "export const main = () => Effect.gen(function* () {\n  return Array.from(yield* Stream.make(1, 2).pipe(Stream.map((x) => x + 1), Stream.runCollect))\n})\n"},
	{"dual-no-argument", "export const main = () => Effect.gen(function* () {\n  return yield* p.pipe(Effect.asVoid)\n})\n"},
	{"local-stage", "const twice = <A>(e: Effect.Effect<A>) => Effect.zip(e, e)\nexport const main = () => Effect.gen(function* () {\n  return yield* p.pipe(twice)\n})\n"},
}

func TestMigrationPipeStageQuoted(t *testing.T) {
	if chapter := SpecText("007-tooling.md"); !strings.Contains(chapter, migrationPipeStageQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationPipeStageQuote)
	}
}

func FuzzMigrationPipeStage(f *testing.F) {
	startShortBudget(f)
	for _, program := range migrationPipeStagePrograms {
		f.Add(program.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationPipeStageQuoted(t)
		i := slices.IndexFunc(migrationPipeStagePrograms, func(p struct{ key, source string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationPipeStagePrograms)
		}
		program := migrationPipeStagePrograms[i]
		source := migrationPipeStagePrelude + program.source
		toolsGuard(t, migrationPipeStageTarget, func() {
			stock := toolsCompile(t, w, migrationPipeStageTarget, map[string]string{"main.ts": source})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid .ts control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
			}
			files := map[string]string{"main.vibe": source}
			before := toolsCompile(t, w, migrationPipeStageTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if before.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Fatalf("not a project: %s", source)
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationPipeStageTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, migrationPipeStageTarget, "fix:converge", "Chapter 7: %q; --fix failed: %v\n%s", migrationPipeStageQuote, result.Err, source)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, migrationPipeStageTarget, fixed)
			defer after.Remove()
			key := "stage:" + program.key
			if !toolsErrorFree(after) {
				Gap(t, migrationPipeStageTarget, key, "Chapter 7: %q; --fix leaves errors %v\n%s", migrationPipeStageQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid .ts outcome: %+v\n%s", was, source)
				}
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationPipeStageTarget, key, "Chapter 7: %q; the .ts gives %s %s, the fixed .vibe %s %s\n%s", migrationPipeStageQuote, was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationPipeStageTarget, key)
			ExpectPending(t, migrationPipeStageTarget, specCorpusKey(t))
		})
	})
}
