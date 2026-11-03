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

const migrationPipeContextTarget = "FuzzMigrationPipeContext"
const migrationPipeContextQuote = "`vibelang --fix` keeps the existing safe-fix checks and refusal rules."

// In .pipe a curried generic stage takes its type arguments from the stage's
// contextual type; standing alone in f(cb)(%) it takes their constraints, and
// the program's type widens: Smithers' RunStore kept its generator with TS2375.
// The oracle compares the fixed module with the same source as .ts.
const migrationPipeContextPrelude = `import { Effect } from "effect"
type O = { readonly _tag: "A"; readonly n: number } | { readonly _tag: "B" }
const observe = <A extends { readonly _tag: string }>(f: (o: A) => number) => <E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.tap(self, (o) => Effect.sync(() => f(o)))
const p: Effect.Effect<O> = Effect.succeed({ _tag: "A", n: 1 })
`

var migrationPipeContextPrograms = []struct{ key, source string }{
	{"lambda", "export const main = (): Effect.Effect<O> => p.pipe(observe((o) => o._tag.length))\n"},
	{"lambda-in-generator", "export const main = (): Effect.Effect<O> => Effect.gen(function* () {\n  return yield* p\n}).pipe(observe((o) => o._tag.length))\n"},
	{"lambda-nested-try", "export const main = (): Effect.Effect<O> => Effect.gen(function* () {\n  return yield* p.pipe(observe((o) => o._tag.length))\n})\n"},
	{"lambda-then-map", "export const main = () => p.pipe(observe((o) => o._tag.length), Effect.map((o) => o._tag))\n"},
	{"annotated-lambda", "export const main = (): Effect.Effect<O> => p.pipe(observe((o: O) => o._tag.length))\n"},
	{"explicit-type-argument", "export const main = (): Effect.Effect<O> => p.pipe(observe<O>((o) => o._tag.length))\n"},
	{"named-callback", "const size = (o: O) => o._tag.length\nexport const main = (): Effect.Effect<O> => p.pipe(observe(size))\n"},
}

func TestMigrationPipeContextQuoted(t *testing.T) {
	if chapter := SpecText("007-tooling.md"); !strings.Contains(chapter, migrationPipeContextQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationPipeContextQuote)
	}
}

func FuzzMigrationPipeContext(f *testing.F) {
	startShortBudget(f)
	for _, program := range migrationPipeContextPrograms {
		f.Add(program.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationPipeContextQuoted(t)
		i := slices.IndexFunc(migrationPipeContextPrograms, func(p struct{ key, source string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationPipeContextPrograms)
		}
		program := migrationPipeContextPrograms[i]
		source := migrationPipeContextPrelude + program.source
		toolsGuard(t, migrationPipeContextTarget, func() {
			stock := toolsCompile(t, w, migrationPipeContextTarget, map[string]string{"main.ts": source})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid .ts control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
			}
			files := map[string]string{"main.vibe": source}
			before := toolsCompile(t, w, migrationPipeContextTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if before.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Fatalf("not a project: %s", source)
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationPipeContextTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, migrationPipeContextTarget, "fix:converge", "Chapter 7: %q; --fix failed: %v\n%s", migrationPipeContextQuote, result.Err, source)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, migrationPipeContextTarget, fixed)
			defer after.Remove()
			key := "context:" + program.key
			if !toolsErrorFree(after) {
				Gap(t, migrationPipeContextTarget, key, "Chapter 7: %q; --fix leaves errors %v\n%s", migrationPipeContextQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid .ts outcome: %+v\n%s", was, source)
				}
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationPipeContextTarget, key, "Chapter 7: %q; the .ts gives %s %s, the fixed .vibe %s %s\n%s", migrationPipeContextQuote, was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationPipeContextTarget, key)
			ExpectPending(t, migrationPipeContextTarget, specCorpusKey(t))
		})
	})
}
