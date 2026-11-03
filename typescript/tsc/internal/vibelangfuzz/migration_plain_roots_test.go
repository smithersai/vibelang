package vibelangfuzz

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const migrationPlainRootsTarget = "FuzzMigrationPlainRoots"
const migrationPlainRootsQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."
const migrationPlainRootsNestedQuote = "a plain arrow written inside an `effect` function is a plain function"

func TestMigrationPlainRootsQuoted(t *testing.T) {
	for _, quote := range []string{migrationPlainRootsQuote, migrationPlainRootsNestedQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("Chapter1 no longer says %q", quote)
		}
	}
}

func migrationPlainRootPrograms() map[string][2]string {
	programs := map[string][2]string{}
	for _, runner := range []string{"runSync", "runSyncExit", "runFork", "runPromise", "runPromiseExit"} {
		call := "Effect." + runner + "(Effect.succeed(1))"
		for home, body := range map[string]string{
			"module":         "export const result = " + call + ";",
			"function":       "export function root() { return " + call + "; }",
			"arrow":          "export const root = () => " + call + ";",
			"object":         "export const roots = { run() { return " + call + "; } };",
			"class":          "export class Roots { run() { return " + call + "; } }",
			"getter":         "export const roots = { get result() { return " + call + "; } };",
			"callback":       "export const roots = [1].map(() => " + call + ");",
			"factory":        "export const make = () => () => " + call + ";",
			"async-function": "export async function root() { return " + call + "; }",
			"async-arrow":    "export const root = async () => " + call + ";",
		} {
			source := "import { Effect } from \"effect\";\n" + body + "\n"
			programs[runner+":"+home] = [2]string{source, source}
		}
	}
	// Exact T3code Cursor SDK witness: the enclosing factory's fiber does not
	// become the later SDK invocation's execution context.
	programs["captured-sdk"] = [2]string{
		"import * as Effect from \"effect/Effect\";\nexport effect function make() {\n  const run = Effect.runPromiseWith(try Effect.context<never>());\n  const a = (): Promise<number> => run(effect { return 1; });\n  function b(): Promise<number> { return run(effect { return 1; }); }\n  return { a, b };\n}\n",
		"import * as Effect from \"effect/Effect\";\nexport function make() { return Effect.gen(function* () {\n const run = Effect.runPromiseWith(yield* Effect.context<never>());\n const a = (): Promise<number> => run(Effect.gen(function* () { return 1; }));\n function b(): Promise<number> { return run(Effect.gen(function* () { return 1; })); }\n return {a,b};\n}); }\n",
	}

	// Alchemy43/Opencode rf3: a plain callback passed from an Effect factory
	// has the same native body as a returned closure or named function.
	for _, runner := range []string{"runSyncWith", "runSyncExitWith", "runPromiseWith"} {
		for home, body := range map[string]string{
			"argument": "transform(() => { run(Effect.void) });",
			"nested":   "transform(() => transform(() => { run(Effect.void) }));",
			"array":    "[1].forEach(() => { run(Effect.void) });",
			"returned": "return () => run(Effect.void);",
		} {
			head := "import { Effect } from \"effect\";\n"
			setup := "const run = Effect." + runner + "(% Effect.context<never>()); const transform = (f: () => void) => f(); "
			programs["alchemy-"+runner+":"+home] = [2]string{
				head + "export const a = effect { " + strings.ReplaceAll(setup, "%", "try") + body + " };\n",
				head + "export const a = Effect.gen(function* () { " + strings.ReplaceAll(setup, "%", "yield*") + body + " });\n",
			}
		}
	}
	return programs
}

// Foldkit plain roots and the T3code captured runtime obey ordinary callable
// boundaries. Compare admission against the documented TypeScript counterpart;
// runtime callable behavior stays in FuzzVIPDifferential.
func FuzzMigrationPlainRoots(f *testing.F) {
	startShortBudget(f)
	programs := migrationPlainRootPrograms()
	keys := []string{}
	for key := range programs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key, programs[key][0])
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key, source string) {
		TestMigrationPlainRootsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		if len(source) > 12<<10 || Admissible(Single(source)) != "" {
			return
		}
		known := programs[key][0]
		reference := source
		if programs[key][1] != known {
			if source != known {
				return
			} // The explicit factory counterpart is a keyed generator case.
			reference = programs[key][1]
		}
		var before, after *Result
		var err error
		within(t, "check native root runner", func() { before, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": reference}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			if source != known {
				t.Skip("mutated root runner is not valid TypeScript")
			}
			t.Fatalf("root counterpart must compile: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), reference)
		}
		within(t, "check Vibe root runner", func() { after, err = w.Compile(t.Context(), Single(source)) })
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if source != known {
			key += fmt.Sprintf(":mutation:%x", sha256.Sum256([]byte(source)))
		}
		errors := []string{}
		// This independent legacy discard diagnostic belongs to the queued
		// plain-structured-result-discard fix. Never admit EK1005 here.
		structuredKey := ""
		if source == known && strings.HasPrefix(key, "alchemy-runSyncExitWith:") && key != "alchemy-runSyncExitWith:returned" {
			structuredKey = "root:" + key + ":structured-discard"
		}
		structuredErrors := []string{}
		for _, d := range after.Diagnostics {
			if d.Category().Name() == "error" && (source == known || IsEK(d) && d.Code() == 1005) {
				if structuredKey != "" && IsEK(d) && d.Code() == 4301 {
					structuredErrors = append(structuredErrors, diagnosticKey(d))
				} else {
					errors = append(errors, diagnosticKey(d))
				}
			}
		}
		if len(structuredErrors) > 0 {
			Gap(t, migrationPlainRootsTarget, structuredKey, "VIP-1 plain body: %q; legacy structured-result discard reports %v", migrationPlainRootsNestedQuote, structuredErrors)
		}
		if structuredKey != "" {
			ExpectPending(t, migrationPlainRootsTarget, structuredKey)
		}
		if len(errors) > 0 {
			Gap(t, migrationPlainRootsTarget, "root:"+key, "Chapter1: %q; %q. Native TypeScript counterpart passes, Vibe callable reports %v\n%s", migrationPlainRootsQuote, migrationPlainRootsNestedQuote, errors, source)
		}
		ExpectPending(t, migrationPlainRootsTarget, "root:"+key)
		ExpectPending(t, migrationPlainRootsTarget, specCorpusKey(t))
	})
}
