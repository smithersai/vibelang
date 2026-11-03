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
const migrationDefectMapperContract = "export function validateGlob(pattern: string): string | undefined { return pattern === \"valid\" ? undefined : \"bad\" }\n"

var migrationDefectMapperPrograms = []struct{ key, source string }{
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
			if result.Err != nil {
				Gap(t, migrationDefectMapperTarget, oracleKey, "Chapter 7: %q; fix failed: %v", migrationDefectMapperQuote, result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if strings.Contains(fixed["main.vibe"], "catch: (error) => error") {
				Gap(t, migrationDefectMapperTarget, oracleKey, "migration adds an uncovered catch closure instead of reusing Effect identity\n%s", fixed["main.vibe"])
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
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationDefectMapperTarget, oracleKey, "bridge defect outcome differs: .ts %s %s; migrated %s %s\n%s", was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationDefectMapperTarget, oracleKey)
			ExpectPending(t, migrationDefectMapperTarget, specCorpusKey(t))
		})
	})
}
