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

const migrationDefectMapperTarget = "FuzzMigrationDefectMapper"
const migrationDefectMapperQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
const migrationDefectMapperContract = "export function validateGlob(pattern: string): string | undefined { return pattern === \"valid\" ? undefined : \"bad\" }\n" + `
export type Input<T> = T | { readonly deferred: () => T };
export const isResolved = <T>(v:Input<T>):v is T => !hasUnresolved(v);
const hasUnresolved=(v:unknown):boolean => v!==null && typeof v==="object" && ("deferred" in v || Object.values(v).some(hasUnresolved));
export const havePropsChanged=(a:object,b:object)=>JSON.stringify(a)!==JSON.stringify(b);
export function makeNews(mode: number): object {
  if (mode === 1) return Object.defineProperty({}, "value", { enumerable: true, get() { throw "getter defect" } });
  if (mode === 2) return { value: 1n };
  return { value: 1 };
}
`

var migrationDefectMapperPrograms = []struct{ key, source string }{
	{"alchemy-success", "import { isResolved, havePropsChanged, makeNews } from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { const news = makeNews(0); if (!isResolved(news)) return undefined; return havePropsChanged({}, news) ? \"update\" : \"noop\" })\n"},
	{"alchemy-getter", "import { isResolved, havePropsChanged, makeNews } from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { const news = makeNews(1); if (!isResolved(news)) return undefined; return havePropsChanged({}, news) ? \"update\" : \"noop\" })\n"},
	{"alchemy-bigint", "import { isResolved, havePropsChanged, makeNews } from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { const news = makeNews(2); if (!isResolved(news)) return undefined; return havePropsChanged({}, news) ? \"update\" : \"noop\" })\n"},
	{"smithers-glob", "import * as Contract from \"./contract.js\"\nexport const main = () => Effect.gen(function* () { return Contract.validateGlob(\"valid\") ?? \"ok\" })\n"},
	{"plain-good", "export const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"plain-bad", "export const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"top-shadow-good", "const identity = \"shadow\"; void identity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"top-shadow-bad", "const identity = \"shadow\"; void identity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"inner-shadow-good", "export const main = () => Effect.gen(function* () {\nconst identity = \"shadow\"; void identity\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"inner-shadow-bad", "export const main = () => Effect.gen(function* () {\nconst identity = \"shadow\"; void identity\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"existing-alias-good", "import { identity as preserve } from \"effect/Function\"\nvoid preserve\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"existing-alias-bad", "import { identity as preserve } from \"effect/Function\"\nvoid preserve\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"namespace-shadow-good", "const Function = { identity: \"shadow\" }; void Function\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"namespace-shadow-bad", "const Function = { identity: \"shadow\" }; void Function\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"occupied-names-good", "const identity = 1, identity2 = 2; void [identity, identity2]\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"occupied-names-bad", "const identity = 1, identity2 = 2; void [identity, identity2]\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
	{"escaped-shadow-good", "const \\u0069dentity = \"shadow\"; void \\u0069dentity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"1\") as number\n})\n"},
	{"escaped-shadow-bad", "const \\u0069dentity = \"shadow\"; void \\u0069dentity\nexport const main = () => Effect.gen(function* () {\nreturn JSON.parse(\"{\") as number\n})\n"},
}

func TestMigrationDefectMapperQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDefectMapperQuote) {
		t.Fatalf("Chapter 7 no longer contains %q", migrationDefectMapperQuote)
	}
}

func FuzzMigrationDefectMapper(f *testing.F) {
	startShortBudget(f)
	for _, p := range migrationDefectMapperPrograms {
		f.Add(p.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationDefectMapperQuoted(t)
		i := slices.IndexFunc(migrationDefectMapperPrograms, func(p struct{ key, source string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationDefectMapperPrograms)
		}
		p := migrationDefectMapperPrograms[i]
		source := "import { Effect } from \"effect\"\n" + p.source
		toolsGuard(t, migrationDefectMapperTarget, func() {
			stock := toolsCompile(t, w, migrationDefectMapperTarget, map[string]string{"main.ts": source, "contract.ts": migrationDefectMapperContract})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid TypeScript control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
			}
			files := map[string]string{"main.vibe": source, "contract.ts": migrationDefectMapperContract}
			before := toolsCompile(t, w, migrationDefectMapperTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) > 0 {
				t.Fatal("invalid migration configuration")
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationDefectMapperTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			oracleKey := "mapper:" + p.key
			if result.Err != nil || len(result.Refused) != 0 {
				Gap(t, migrationDefectMapperTarget, oracleKey, "Chapter 7: %q; fix failed: %v; refused: %v", migrationDefectMapperQuote, result.Err, result.Refused)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if !strings.Contains(fixed["main.vibe"], "catch: (e) => e") || strings.Count(fixed["main.vibe"], "effect/Function") != strings.Count(source, "effect/Function") {
				Gap(t, migrationDefectMapperTarget, oracleKey, "migration must emit a nonthrowing inline mapper and preserve existing imports\n%s", fixed["main.vibe"])
			}
			after := toolsCompile(t, w, migrationDefectMapperTarget, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, migrationDefectMapperTarget, oracleKey, "bridge migration leaves errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid TypeScript outcome: %+v\n%s", was, source)
				}
				// Fuzz oracle: the bridge Exit equals its gen twin for throwing and non-throwing callees.
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) || was.Tag != is.Tag || !slices.Equal(was.Cause, is.Cause) {
					Gap(t, migrationDefectMapperTarget, oracleKey, "bridge defect outcome differs: .ts %+v; migrated %+v\n%s", was, is, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationDefectMapperTarget, oracleKey)
			ExpectPending(t, migrationDefectMapperTarget, specCorpusKey(t))
		})
	})
}
