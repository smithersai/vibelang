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

const migrationForeignInputsTarget = "FuzzMigrationForeignInputs"
const migrationForeignInputsQuote = "`vibelang --fix` keeps the existing safe-fix checks and refusal rules."

// EK4401's fix moves a call's Effect operand to a const before the statement.
// --fix plans a round's fixes on one tree, and two calls of one function each
// named their operand a2, so the round's program reported TS2451 and both fixes
// were refused: Smithers' setup (response) and files (context2) kept EK4401. The
// oracle is the same program as Effect TypeScript, whose calls throw as defects.
var migrationForeignInputsPrograms = []struct{ key, vibe, ts string }{
	{"two-operands-one-base",
		"export const main = effect () => {\n  const a = plain(try one, 1)\n  const b = plain(try one, 2)\n  return [a, b]\n}\n",
		"export const main = () => Effect.gen(function* () {\n  const a = plain(yield* one, 1)\n  const b = plain(yield* one, 2)\n  return [a, b]\n})\n"},
	{"four-operands",
		"export const main = effect () => {\n  const a = plain(try one, 1)\n  const b = plain(try one, 2)\n  const c = plain(try one, 3)\n  const d = plain(try one, 4)\n  return [a, b, c, d]\n}\n",
		"export const main = () => Effect.gen(function* () {\n  const a = plain(yield* one, 1)\n  const b = plain(yield* one, 2)\n  const c = plain(yield* one, 3)\n  const d = plain(yield* one, 4)\n  return [a, b, c, d]\n})\n"},
	{"name-already-taken",
		"export const main = effect () => {\n  const a2 = 7\n  const a = plain(try one, a2)\n  const b = plain(try one, a2)\n  return [a, b]\n}\n",
		"export const main = () => Effect.gen(function* () {\n  const a2 = 7\n  const a = plain(yield* one, a2)\n  const b = plain(yield* one, a2)\n  return [a, b]\n})\n"},
	{"both-operands",
		"export const main = effect () => {\n  const a = pair(try one, try two)\n  const b = pair(try two, try one)\n  return [a, b]\n}\n",
		"export const main = () => Effect.gen(function* () {\n  const a = pair(yield* one, yield* two)\n  const b = pair(yield* two, yield* one)\n  return [a, b]\n})\n"},
	{"block-then-outer",
		"export const main = effect () => {\n  let a = 0\n  if (true) {\n    a = plain(try one, 1)\n  }\n  const b = plain(try one, 2)\n  return [a, b]\n}\n",
		"export const main = () => Effect.gen(function* () {\n  let a = 0\n  if (true) {\n    a = plain(yield* one, 1)\n  }\n  const b = plain(yield* one, 2)\n  return [a, b]\n})\n"},
	{"two-functions",
		"const f = effect {\n  return plain(try one, 1)\n}\nexport const main = effect () => {\n  const a = plain(try one, 2)\n  return [try f, a]\n}\n",
		"const f = Effect.gen(function* () {\n  return plain(yield* one, 1)\n})\nexport const main = () => Effect.gen(function* () {\n  const a = plain(yield* one, 2)\n  return [yield* f, a]\n})\n"},
	{"throws-keeps-order",
		"export const main = effect () => {\n  const a = plain(try one, 1)\n  const b = boom(try one)\n  const c = plain(try one, 3)\n  return [a, b, c]\n}\n",
		"export const main = () => Effect.gen(function* () {\n  const a = plain(yield* one, 1)\n  const b = boom(yield* one)\n  const c = plain(yield* one, 3)\n  return [a, b, c]\n})\n"},
	{"narrowed-property-and-running-input", "export const main = effect () => {\n  const input: { value: number | null } = { value: 3 }\n  if (input.value === null) return []\n  const a = plain(input.value, try one)\n  const b = plain(input.value, try one)\n  return [a, b]\n}\n", "export const main = () => Effect.gen(function* () {\n  const input: { value: number | null } = { value: 3 }\n  if (input.value === null) return []\n  const a = plain(input.value, yield* one)\n  const b = plain(input.value, yield* one)\n  return [a, b]\n})\n"},
	{"unsafe-narrowed-read-after-running-input", "export const main = effect () => {\n  const input: { value: number | null } = { value: 3 }\n  if (input.value === null) return []\n  const a = plain(try one, input.value)\n  const b = plain(try one, input.value)\n  return [a, b]\n}\n", "export const main = () => Effect.gen(function* () {\n  const input: { value: number | null } = { value: 3 }\n  if (input.value === null) return []\n  const a = plain(yield* one, input.value)\n  const b = plain(yield* one, input.value)\n  return [a, b]\n})\n"},
	{"unsafe-narrowed-read-after-mutation", "export const main = effect () => {\n  const input: { value: number | null } = { value: 3 }\n  const mutate = effect { input.value = null; return 1 }\n  if (input.value === null) return []\n  const a = plain(try mutate, input.value)\n  const b = plain(try mutate, input.value)\n  return [a, b]\n}\n", "export const main = () => Effect.gen(function* () {\n  const input: { value: number | null } = { value: 3 }\n  const mutate = Effect.sync(() => { input.value = null; return 1 })\n  if (input.value === null) return []\n  const a = plain(yield* mutate, input.value)\n  const b = plain(yield* mutate, input.value)\n  return [a, b]\n})\n"},
	{"narrowed-property-only", "export const main = effect () => {\n  const input: { value: number | null } = { value: 3 }\n  if (input.value === null) return []\n  const a = plain(input.value, 1)\n  const b = plain(input.value, 1)\n  return [a, b]\n}\n", "export const main = () => Effect.gen(function* () {\n  const input: { value: number | null } = { value: 3 }\n  if (input.value === null) return []\n  const a = plain(input.value, 1)\n  const b = plain(input.value, 1)\n  return [a, b]\n})\n"},
}

const migrationForeignInputsPlain = "export const plain = (a: number, b: number) => a + b\nexport const pair = (a: number, b: number) => a * 10 + b\nexport const boom = (a: number): number => { throw new Error(\"boom \" + a) }\n"
const migrationForeignInputsVibeHead = "import { boom, pair, plain } from \"./plain.js\"\nconst one = effect { return 1 }\n"

func TestMigrationForeignInputsQuoted(t *testing.T) {
	if chapter := SpecText("007-tooling.md"); !strings.Contains(chapter, migrationForeignInputsQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationForeignInputsQuote)
	}
}

func FuzzMigrationForeignInputs(f *testing.F) {
	startShortBudget(f)
	for _, program := range migrationForeignInputsPrograms {
		f.Add(program.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationForeignInputsQuoted(t)
		i := slices.IndexFunc(migrationForeignInputsPrograms, func(p struct{ key, vibe, ts string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationForeignInputsPrograms)
		}
		program := migrationForeignInputsPrograms[i]
		head := "import { Effect } from \"effect\"\nimport { boom, pair, plain } from \"./plain.js\"\nconst one = Effect.succeed(1)\nconst two = Effect.succeed(2)\n"
		source := migrationForeignInputsVibeHead + "const two = effect { return 2 }\n" + program.vibe
		toolsGuard(t, migrationForeignInputsTarget, func() {
			stock := toolsCompile(t, w, migrationForeignInputsTarget, map[string]string{"main.ts": head + program.ts, "plain.ts": migrationForeignInputsPlain})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid .ts control: %v", SortedKeys(Keys(stock.Dir, stock.Diagnostics)))
			}
			files := map[string]string{"main.vibe": source, "plain.ts": migrationForeignInputsPlain}
			before := toolsCompile(t, w, migrationForeignInputsTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if before.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Fatalf("not a project: %s", source)
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationForeignInputsTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, migrationForeignInputsTarget, "fix:converge", "Chapter 7: %q; --fix failed: %v\n%s", migrationForeignInputsQuote, result.Err, source)
			}
			gapKey := "inputs:" + program.key
			if len(result.Refused) != 0 && !strings.HasPrefix(program.key, "unsafe-") {
				Gap(t, migrationForeignInputsTarget, gapKey, "EK4401's fix refused a call for a name it chose: %+v\n%s", result.Refused, source)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, migrationForeignInputsTarget, fixed)
			defer after.Remove()
			// A running argument before the narrowed property may change that
			// property. The safe-fix rule permits refusal, keeping each such
			// site intact; a future complete repair must pass the same runtime
			// comparison as the supported cases below.
			if !toolsErrorFree(after) && strings.HasPrefix(program.key, "unsafe-") {
				keys := SortedKeys(Keys(after.Dir, after.Diagnostics))
				for _, key := range keys {
					if key.Source != "EK" || key.Code != vibelang.EK4401.Code && key.Code != vibelang.EK0403.Code {
						t.Fatalf("unsafe order added an unrelated diagnostic: %v", keys)
					}
				}
				site := "plain(try one, input.value)"
				if strings.Contains(program.key, "mutation") {
					site = "plain(try mutate, input.value)"
				}
				if len(keys) == 0 || strings.Count(fixed["main.vibe"], site) != len(keys) {
					t.Fatalf("refused sites changed: %v; source: %s", keys, fixed["main.vibe"])
				}
				ExpectPending(t, migrationForeignInputsTarget, gapKey)
				ExpectPending(t, migrationForeignInputsTarget, specCorpusKey(t))
				return
			}
			if !toolsErrorFree(after) {
				Gap(t, migrationForeignInputsTarget, gapKey, "--fix leaves errors %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid .ts outcome: %+v", was)
				}
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationForeignInputsTarget, gapKey, "the .ts gives %s %s, the fixed .vibe %s %s\n%s", was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationForeignInputsTarget, gapKey)
			ExpectPending(t, migrationForeignInputsTarget, specCorpusKey(t))
		})
	})
}
