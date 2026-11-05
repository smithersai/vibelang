package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationWrittenGeneratorTarget = "FuzzMigrationWrittenGenerator"
const migrationWrittenGeneratorQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

// Written generator return types contextualize the returned object. The
// migration must preserve the TypeScript twin's success and failure behavior.
const migrationWrittenGeneratorPrelude = `import { Effect } from "effect"
type Outcome = { readonly kind: "ok"; readonly value: number }
`

var migrationWrittenGeneratorPrograms = []struct{ key, source string }{
	{"smithers-fn-return", "export const main = () => Effect.gen(function* (): Effect.fn.Return<Outcome> { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"smithers-generator-return", "export const main = () => Effect.gen(function* (): Generator<Effect.Effect<unknown>, Outcome, never> { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"alias", "type G = Generator<Effect.Effect<unknown>, Outcome, never>\nexport const main = () => Effect.gen(function* (): G { yield* Effect.void; return { kind: \"ok\", value: 7 } })\n"},
	{"failure", "export const main = () => Effect.result(Effect.gen(function* (): Effect.fn.Return<Outcome, string> { yield* Effect.fail(\"bad\"); return { kind: \"ok\", value: 7 } }))\n"},
	{"t3code-device-hub-record-inexact", ""},
	{"t3code-device-hub-record-exact", ""},
	{"t3code-device-hub-renamed-inexact", ""},
	{"t3code-device-hub-renamed-exact", ""},
	{"t3code-device-hub-conditional-inexact", ""},
	{"t3code-device-hub-conditional-exact", ""},
}

func TestMigrationWrittenGeneratorQuoted(t *testing.T) {
	if chapter := SpecText("007-tooling.md"); !strings.Contains(chapter, migrationWrittenGeneratorQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationWrittenGeneratorQuote)
	}
}

func FuzzMigrationWrittenGenerator(f *testing.F) {
	startShortBudget(f)
	for _, program := range migrationWrittenGeneratorPrograms {
		f.Add(program.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationWrittenGeneratorQuoted(t)
		i := slices.IndexFunc(migrationWrittenGeneratorPrograms, func(p struct{ key, source string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationWrittenGeneratorPrograms)
		}
		program := migrationWrittenGeneratorPrograms[i]
		source := migrationWrittenGeneratorPrelude + program.source
		spanContext := strings.HasPrefix(program.key, "t3code-device-hub-")
		if spanContext {
			raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "t3code-device-hub-written-context.ts"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(raw)
			if strings.Contains(program.key, "-renamed-") {
				source = strings.ReplaceAll(source, "query", "headers")
			}
			if strings.Contains(program.key, "-conditional-") {
				before := "  if (flag) return { query: {} }\n  return { query: { ticket: \"t\" } }"
				after := "  return flag ? { query: {} } : { query: { ticket: \"t\" } }"
				if !strings.Contains(source, before) {
					t.Fatal("span corpus lost its branches")
				}
				source = strings.Replace(source, before, after, 1)
			}
		}
		compile := func(files map[string]string) *Result {
			if !spanContext {
				return toolsCompile(t, w, migrationWrittenGeneratorTarget, files)
			}
			var config map[string]any
			if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
				t.Fatal(err)
			}
			config["compilerOptions"].(map[string]any)["exactOptionalPropertyTypes"] = strings.HasSuffix(program.key, "-exact")
			raw, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			var result *Result
			toolsRun(t, migrationWrittenGeneratorTarget, "compile", Archive(files), nil, func() {
				result, err = w.Compile(t.Context(), Project{Files: files, Config: string(raw)})
			})
			if err != nil {
				t.Fatal(err)
			}
			return result
		}
		toolsGuard(t, migrationWrittenGeneratorTarget, func() {
			stock := compile(map[string]string{"main.ts": source})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid .ts control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
			}
			files := map[string]string{"main.vibe": source}
			before := compile(files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if before.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Fatalf("not a project: %s", source)
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationWrittenGeneratorTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, migrationWrittenGeneratorTarget, "fix:converge", "Chapter 7: %q; --fix failed: %v\n%s", migrationWrittenGeneratorQuote, result.Err, source)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := compile(fixed)
			defer after.Remove()
			key := "context:" + program.key
			if !toolsErrorFree(after) {
				Gap(t, migrationWrittenGeneratorTarget, key, "Chapter 7: %q; --fix leaves errors %v\n%s", migrationWrittenGeneratorQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid .ts outcome: %+v\n%s", was, source)
				}
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationWrittenGeneratorTarget, key, "Chapter 7: %q; the .ts gives %s %s, the fixed .vibe %s %s\n%s", migrationWrittenGeneratorQuote, was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationWrittenGeneratorTarget, key)
			ExpectPending(t, migrationWrittenGeneratorTarget, specCorpusKey(t))
		})
	})
}
