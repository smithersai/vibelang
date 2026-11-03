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

// FuzzVIPLegacyByNameFunctions checks --fix-vip-only on an argument the old
// compiler passed by name (D147: "as if written () => fetchReport()") that
// runs a call and holds a written function. A plain function keeps its form
// inside the effect block, so the oracle is no refusal and a program that
// compiles; a function whose body gives an Effect must stay refused.
//
// A "block-" site's argument is itself an effect block, the program its
// parameter receives: its calls get try where they stand with no block around
// it, whatever plain function it holds, and no refusal (D147).
//
// An input is "<site>:<function>"; other bytes pick by index.
func FuzzVIPLegacyByNameFunctions(f *testing.F) {
	startShortBudget(f)
	for _, site := range slices.Sorted(maps.Keys(legacyByNameSites)) {
		for _, fn := range slices.Sorted(maps.Keys(legacyByNameFunctions)) {
			f.Add([]byte(site + ":" + fn))
		}
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		sites := slices.Sorted(maps.Keys(legacyByNameSites))
		fns := slices.Sorted(maps.Keys(legacyByNameFunctions))
		site, fnKey, _ := strings.Cut(string(data), ":")
		if legacyByNameSites[site] == "" || legacyByNameFunctions[fnKey].text == "" {
			if len(data) < 2 {
				t.Skip("the input names no form")
			}
			site, fnKey = sites[int(data[0])%len(sites)], fns[int(data[1])%len(fns)]
		}
		key := site + ":" + fnKey
		fn := legacyByNameFunctions[fnKey]
		if fn.refused && strings.HasPrefix(site, "block-") {
			t.Skip("an effect block gives its own function its form")
		}
		source := legacyByNameHelpers + strings.ReplaceAll(legacyByNameSites[site], "FN", fn.text)
		files := map[string]string{"main.vibe": source}
		if fnKey == "throws" {
			// Synchronous VibeLang code never throws (EK0401); a .ts file may.
			files["main.vibe"] = "import { raise } from \"./raise.js\"\n" + source
			files["raise.ts"] = "export function raise(e: unknown): never { throw e }\n"
		}
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
		if fn.refused {
			if len(result.Refused) == 0 {
				Gap(t, "FuzzVIPLegacyByNameFunctions", "unrefused/"+key, "--fix-vip-only decided a function whose body gives an Effect:\n%s\nlegacy:\n%s", report.String(), source)
			}
			return
		}
		if result.Err != nil || len(result.Refused) > 0 {
			Gap(t, "FuzzVIPLegacyByNameFunctions", "refused/"+key, "--fix-vip-only refused or did not converge (%v):\n%s\nlegacy:\n%s", result.Err, report.String(), source)
		}
		fixed := maps.Clone(files)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyByNameFunctions", "compile/"+key, "the migrated program does not compile: %s\nmigrated:\n%s\nlegacy:\n%s", strings.Join(errors, "\n"), fixed["main.vibe"], source)
		}
	})
}

// legacyByNameSites are programs where the old compiler passed take(…) by
// name and ran load(1) inside it.
var legacyByNameSites = map[string]string{
	"map-argument": "export effect function f() {\n  return try Effect.map(take(load(1), FN), (n) => n + 1)\n}\n",
	"own-helper":   "export effect function f() {\n  return try hold(take(load(1), FN))\n}\n",
	"block-map":    "export effect function f() {\n  return try Effect.map(effect { return plain(load(1)) + (FN)() }, (n) => n + 1)\n}\n",
	"block-helper": "export effect function f() {\n  return try hold(effect { return plain(load(1)) + (FN)() })\n}\n",
	"block-pipe":   "export effect function f() {\n  return try (effect { return plain(load(1)) + (FN)() } |> Effect.map(%, (n) => n + 1))\n}\n",
	"pipe-topic":   "export effect function f() {\n  return try (take(load(1), FN) |> Effect.map(%, (n) => n + 1))\n}\n",
}

var legacyByNameFunctions = map[string]struct {
	text    string
	refused bool
}{
	"arrow":        {text: "() => 2"},
	"expression":   {text: "function () { return 2 }"},
	"throws":       {text: "(): number => raise(new Error(\"plain\"))"},
	"nested":       {text: "() => [1].map((x) => x + 1)[0]!"},
	"gives-effect": {text: "() => take(1, () => 2) as unknown as number", refused: true},
}

const legacyByNameHelpers = `import { Effect } from "effect"

function plain(n: number): number {
  return n
}

effect function load(n: number): number!! {
  return n
}

effect function take(n: number, thunk: () => number): number!! {
  return n + thunk()
}

effect function hold(program: number!!): number!! {
  return try program
}

`
