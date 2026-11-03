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

const migrationTrackedThrowTarget = "FuzzMigrationTrackedThrow"
const migrationTrackedThrowQuote = "| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |"

// An exception in a generator is a defect in Effect TypeScript, and adds
// nothing to E. Effect code tracks JSON.parse's and TextDecoder's, so --fix wrote
// a typed failure: a catch ran where none did, and the Effect's type changed,
// TS2375 against a written contract (Smithers' Route). The oracle compares the
// fixed module with the same source as .ts: outcome, and a catch in the .ts
// never running.
var migrationTrackedThrowPrograms = []struct{ key, source string }{
	{"parse-bad", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"{\") as number\n})\n"},
	{"parse-good", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"1\") as number\n})\n"},
	{"parse-contract", "export const main = (): Effect.Effect<number> => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"1\") as number\n})\n"},
	{"parse-member", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"[1,2]\").length as number\n})\n"},
	{"parse-statement", "export const main = () => Effect.gen(function* () {\n  JSON.parse(\"{\")\n  return 1\n})\n"},
	{"parse-in-catch", "export const main = () => Effect.catch(Effect.gen(function* () {\n  yield* Effect.void\n  return JSON.parse(\"{\") as number\n}), () => Effect.succeed(0))\n"},
	{"parse-ran-after", "export const main = () => Effect.gen(function* () {\n  const n = yield* Effect.succeed(\"1\")\n  return [n, JSON.parse(n) as number]\n})\n"},
	{"decode-uri", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return decodeURIComponent(\"%\")\n})\n"},
	{"bigint", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return String(BigInt(\"x\"))\n})\n"},
	{"text-decoder", "export const main = (): Effect.Effect<string> => Effect.gen(function* () {\n  yield* Effect.void\n  return new TextDecoder().decode(new Uint8Array(0))\n})\n"},
	{"boundary", "export const main = () => Effect.gen(function* () {\n  return yield* Effect.try(() => JSON.parse(\"{\") as number)\n})\n"},
	{"plain-callback", "export const main = () => Effect.gen(function* () {\n  yield* Effect.void\n  return [\"1\"].map((s) => s + \"!\")\n})\n"},
}

func TestMigrationTrackedThrowQuoted(t *testing.T) {
	if chapter := SpecText("003-failures.md"); !strings.Contains(chapter, migrationTrackedThrowQuote) {
		t.Fatalf("Chapter 3 no longer says %q", migrationTrackedThrowQuote)
	}
}

func FuzzMigrationTrackedThrow(f *testing.F) {
	startShortBudget(f)
	for _, program := range migrationTrackedThrowPrograms {
		f.Add(program.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationTrackedThrowQuoted(t)
		i := slices.IndexFunc(migrationTrackedThrowPrograms, func(p struct{ key, source string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationTrackedThrowPrograms)
		}
		program := migrationTrackedThrowPrograms[i]
		source := "import { Effect } from \"effect\"\n" + program.source
		toolsGuard(t, migrationTrackedThrowTarget, func() {
			stock := toolsCompile(t, w, migrationTrackedThrowTarget, map[string]string{"main.ts": source})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid .ts control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
			}
			files := map[string]string{"main.vibe": source}
			before := toolsCompile(t, w, migrationTrackedThrowTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if before.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Fatalf("not a project: %s", source)
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationTrackedThrowTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, migrationTrackedThrowTarget, "fix:converge", "Chapter 3: %q; --fix failed: %v\n%s", migrationTrackedThrowQuote, result.Err, source)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, migrationTrackedThrowTarget, fixed)
			defer after.Remove()
			key := "throw:" + program.key
			if !toolsErrorFree(after) {
				Gap(t, migrationTrackedThrowTarget, key, "Chapter 3: %q; --fix leaves errors %v\n%s", migrationTrackedThrowQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid .ts outcome: %+v\n%s", was, source)
				}
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationTrackedThrowTarget, key, "Chapter 3: %q; the .ts gives %s %s, the fixed .vibe %s %s\n%s", migrationTrackedThrowQuote, was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationTrackedThrowTarget, key)
			ExpectPending(t, migrationTrackedThrowTarget, specCorpusKey(t))
		})
	})
}
