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

// FuzzVIPLegacyPlainHandlers checks --fix-vip-only on a literal passed where
// every overload expects a function that returns an Effect, with a plain result
// (D44: "the declared parameter type chooses a lambda's form"). The oracle: no
// refusal, and a program that compiles. An input is "<operator>:<handler>"; other
// bytes pick by index.
func FuzzVIPLegacyPlainHandlers(f *testing.F) {
	startShortBudget(f)
	for _, operator := range slices.Sorted(maps.Keys(legacyPlainOperators)) {
		for _, handler := range slices.Sorted(maps.Keys(legacyPlainHandlers)) {
			f.Add([]byte(operator + ":" + handler))
		}
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		operators := slices.Sorted(maps.Keys(legacyPlainOperators))
		handlers := slices.Sorted(maps.Keys(legacyPlainHandlers))
		operator, handler, _ := strings.Cut(string(data), ":")
		if legacyPlainOperators[operator] == "" || legacyPlainHandlers[handler] == "" {
			if len(data) < 2 {
				t.Skip("the input names no form")
			}
			operator, handler = operators[int(data[0])%len(operators)], handlers[int(data[1])%len(handlers)]
		}
		key := operator + ":" + handler
		source := legacyPlainHandlerHelpers + strings.ReplaceAll(legacyPlainOperators[operator], "HANDLER", legacyPlainHandlers[handler])
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
			Gap(t, "FuzzVIPLegacyPlainHandlers", "refused/"+key, "--fix-vip-only refused or did not converge (%v):\n%s\nlegacy:\n%s", result.Err, report.String(), source)
		}
		fixed := maps.Clone(files)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyPlainHandlers", "compile/"+key, "the migrated program does not compile: %s\nmigrated:\n%s\nlegacy:\n%s", strings.Join(errors, "\n"), fixed["main.vibe"], source)
		}
	})
}

var legacyPlainOperators = map[string]string{
	"catchTag-topic": "export function g(p: string!Boom): string!! {\n  return p |> Effect.catchTag(%, \"Boom\", HANDLER)\n}\n",
	"catchTag-first": "export const g = (p: string!Boom): string!! => Effect.catchTag(p, \"Boom\", HANDLER)\n",
	"catch-first":    "export const g = (p: string!Boom): string!! => Effect.catch(p, HANDLER)\n",
	"flatMap-first":  "export const g = (p: Boom!!): string!! => Effect.flatMap(p, HANDLER)\n",
}

var legacyPlainHandlers = map[string]string{
	"member":   "(caught) => caught.message",
	"template": "(caught) => `b:${caught.message}`",
	"literal":  "() => \"fallback\"",
	"block":    "(caught) => {\n    return caught.message\n  }",
}

const legacyPlainHandlerHelpers = `import { Effect } from "effect"

class Boom extends Error {
  readonly _tag = "Boom"
}

`
