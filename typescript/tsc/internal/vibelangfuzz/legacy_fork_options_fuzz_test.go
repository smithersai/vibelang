package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzVIPLegacyForkOptions checks --fix-vip-only on pre-VIP-1 functions that
// call the prelude's fork with options, fork(program, options). fork is
// reserved in effect code (VIP-17: "reserved in effect code"), so once the
// function is marked the same text would read as fork over a comma expression.
// The oracle: no refusal, no fork call with two operands left, and the migrated
// program compiles (Smithers agent/fs CommandSurface.test.vibe,
// FileRouter.test.vibe).
//
// An input is "<owner>:<position>:<options>"; other bytes pick by index.
func FuzzVIPLegacyForkOptions(f *testing.F) {
	startShortBudget(f)
	legacyForkOptionsQuoted(f)
	for _, owner := range slices.Sorted(maps.Keys(legacyForkOwners)) {
		for _, position := range slices.Sorted(maps.Keys(legacyForkPositions)) {
			for _, options := range slices.Sorted(maps.Keys(legacyForkOptions)) {
				f.Add([]byte(owner + ":" + position + ":" + options))
			}
		}
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, source := legacyForkInput(data)
		if source == "" {
			t.Skip("the input names no form")
		}
		files := map[string]string{"main.vibe": source}
		old := legacyCompile(t, env, files)
		defer old.Remove()
		config := toolsConfig(env.w, old.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatalf("config of the legacy program: %v", config)
		}
		var result *vibelang.FixResult
		Within("fix", func() {
			result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		})
		var report strings.Builder
		result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
		if result.Err != nil || len(result.Refused) > 0 {
			Gap(t, "FuzzVIPLegacyForkOptions", "refused/"+key, "--fix-vip-only refused or did not converge (%v):\n%s\nlegacy:\n%s", result.Err, report.String(), source)
		}
		fixed := maps.Clone(files)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		if strings.Contains(fixed["main.vibe"], "fork(work(") {
			Gap(t, "FuzzVIPLegacyForkOptions", "left/"+key, "a fork with options was left as written:\n%s", fixed["main.vibe"])
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyForkOptions", "compile/"+key, "the migrated program does not compile: %s\nmigrated:\n%s\nlegacy:\n%s", strings.Join(errors, "\n"), fixed["main.vibe"], source)
		}
	})
}

// legacyForkOwners hold BODY: each is a function the old compiler made an
// Effect function from its return type.
var legacyForkOwners = map[string]string{
	"marked-arrow":       "export const g = effect (n: number): number!! => {\nBODY\n}\n",
	"marked-declaration": "export effect function g(n: number): number!! {\nBODY\n}\n",
	"marked-field-arrow": "export const api = {\n  g: effect (n: number): number!! => {\nBODY\n  },\n}\n",

	"annotated-arrow": "export const g = (n: number): number!! => {\nBODY\n}\n",
	"declaration":     "export function g(n: number): number!! {\nBODY\n}\n",
	"field-arrow":     "export const api = {\n  g: (n: number): number!! => {\nBODY\n  },\n}\n",
}

// legacyForkPositions are where the fork stands; OPTIONS is the second argument.
var legacyForkPositions = map[string]string{
	"initializer": "  const pending = fork(work(n), OPTIONS)\n  return join pending",
	"statement":   "  fork(work(n), OPTIONS)\n  return n",
	"member":      "  const id = fork(work(n), OPTIONS).id\n  return String(id).length",
	"branch":      "  if (n > 0) {\n    const pending = fork(work(n), OPTIONS)\n    return join pending\n  }\n  return n",
	"loop":        "  for (const m of [n]) {\n    fork(work(m), OPTIONS)\n  }\n  return n",
}

var legacyForkOptions = map[string]string{
	"literal": "{ startImmediately: true }",
	"named":   "legacyForkOptionsValue",
	"empty":   "{}",
}

const legacyForkHelpers = `import { Effect } from "effect"

const legacyForkOptionsValue = { startImmediately: true }

const work = effect (n: number): number!! => n + 1

`

func legacyForkInput(data []byte) (key, source string) {
	owners := slices.Sorted(maps.Keys(legacyForkOwners))
	positions := slices.Sorted(maps.Keys(legacyForkPositions))
	options := slices.Sorted(maps.Keys(legacyForkOptions))
	parts := strings.Split(string(data), ":")
	if len(parts) != 3 || legacyForkOwners[parts[0]] == "" || legacyForkPositions[parts[1]] == "" || legacyForkOptions[parts[2]] == "" {
		if len(data) < 3 {
			return "", ""
		}
		parts = []string{owners[int(data[0])%len(owners)], positions[int(data[1])%len(positions)], options[int(data[2])%len(options)]}
	}
	body := strings.ReplaceAll(legacyForkPositions[parts[1]], "OPTIONS", legacyForkOptions[parts[2]])
	if parts[0] == "field-arrow" {
		body = "  " + strings.ReplaceAll(body, "\n", "\n  ")
	}
	return strings.Join(parts, ":"), legacyForkHelpers + strings.ReplaceAll(legacyForkOwners[parts[0]], "BODY", body)
}

const legacyForkOptionsQuote = "writes `try Effect.forkChild(program, options)` for the legacy `fork(program, options)`."

func legacyForkOptionsQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), legacyForkOptionsQuote) {
		t.Fatalf("007-tooling.md no longer contains migration oracle %q", legacyForkOptionsQuote)
	}
}

func TestVIPLegacyForkOptionsQuoted(t *testing.T) { legacyForkOptionsQuoted(t) }
