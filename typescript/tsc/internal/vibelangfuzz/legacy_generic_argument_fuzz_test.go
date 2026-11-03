package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzVIPLegacyGenericArgument checks --fix-vip-only on a call passed where an
// unconstrained type parameter stands, which the old compiler ran (detail 274:
// "A legacy migration preserves the old call's result/run phase"). Each body
// uses the result as a number, so a program left unrun does not compile. This
// is the silent case: left alone, the file's own check accepts T = Effect, and
// only the number use exposes it. An input is "<signature>:<position>"; other
// bytes pick by index.
func FuzzVIPLegacyGenericArgument(f *testing.F) {
	startShortBudget(f)
	legacyGenericArgumentQuoted(f)
	for _, signature := range slices.Sorted(maps.Keys(legacyGenericSignatures)) {
		for _, position := range slices.Sorted(maps.Keys(legacyGenericPositions)) {
			f.Add([]byte(signature + ":" + position))
		}
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		signatures := slices.Sorted(maps.Keys(legacyGenericSignatures))
		positions := slices.Sorted(maps.Keys(legacyGenericPositions))
		signature, position, _ := strings.Cut(string(data), ":")
		if legacyGenericSignatures[signature] == "" || legacyGenericPositions[position] == "" {
			if len(data) < 2 {
				t.Skip("the input names no form")
			}
			signature, position = signatures[int(data[0])%len(signatures)], positions[int(data[1])%len(positions)]
		}
		key := signature + ":" + position
		body := legacyGenericPositions[position]
		prelude := legacyGenericHelpers + legacyGenericSignatures[signature] + "\n\n"
		if signature == "shared" || signature == "shared-value" {
			if signature == "shared" {
				prelude += "const other: number!! = Effect.succeed(2)\n\n"
			} else {
				prelude += "const other = 2\n\n"
			}
			body = strings.ReplaceAll(body, "check(load(1))", "check(load(1), other)")
		}
		source := prelude + body
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
			Gap(t, "FuzzVIPLegacyGenericArgument", "refused/"+key, "--fix-vip-only refused or did not converge (%v):\n%s\nlegacy:\n%s", result.Err, report.String(), source)
		}
		fixed := maps.Clone(files)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyGenericArgument", "compile/"+key, "the migrated program does not compile: %s\nmigrated:\n%s\nlegacy:\n%s", strings.Join(errors, "\n"), fixed["main.vibe"], source)
		}
	})
}

var legacyGenericSignatures = map[string]string{
	"shared-value": "declare function check<T>(actual: T, other: T): T",
	"shared":       "declare function check<T>(actual: T, other: T): T",
	"one":          "declare function check<T>(actual: T): T",
	"optional":     "declare function check<T>(actual: T, message?: string): T",
	"two-type":     "declare function check<T, U = string>(actual: T, other?: U): T",
	"rest":         "declare function check<T>(actual: T, ...rest: Array<string>): T",
	"unknown":      "declare function check<T extends unknown>(actual: T, message?: string): T",
}

var legacyGenericPositions = map[string]string{
	"return":      "export effect function f(): number!! {\n  return check(load(1)) + 1\n}\n",
	"initializer": "export effect function f(): number!! {\n  const n: number = check(load(1))\n  return n\n}\n",
	"argument":    "export effect function f(): number!! {\n  return plain(check(load(1)))\n}\n",
	"member":      "export effect function f(): number!! {\n  return check(load(1)).toFixed(1).length\n}\n",
	"arrow":       "export const f = effect (): number!! => check(load(1)) + 1\n",
}

const legacyGenericHelpers = `import { Effect } from "effect"

function load(n: number): Effect.Effect<number> {
  return Effect.succeed(n)
}

function plain(n: number): number {
  return n
}

`

// The migration's run phase is a tooling rule, rather than a new language rule.
const legacyGenericArgumentQuote = "preserves evaluation order, captures, the call-versus-run phase, coldness, error and environment channels, and public declarations."

func legacyGenericArgumentQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), legacyGenericArgumentQuote) {
		t.Fatalf("007-tooling.md no longer contains migration oracle %q", legacyGenericArgumentQuote)
	}
}

func TestVIPLegacyGenericArgumentQuoted(t *testing.T) { legacyGenericArgumentQuoted(t) }
