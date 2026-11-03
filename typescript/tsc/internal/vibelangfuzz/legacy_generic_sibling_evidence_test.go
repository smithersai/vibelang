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

// Chapter 7: "The rewrite preserves runtime behavior." A boolean-returning
// helper cannot mask an unrun argument by making the outer call an Effect.
func FuzzVIPGenericSiblingEvidence(f *testing.F) {
	startShortBudget(f)
	legacyGenericArgumentQuoted(f)
	shapes := map[string]struct {
		parameter, argument string
		two                 bool
	}{
		"optional-undefined":      {"other?: T", "undefined", false},
		"optional-void":           {"other?: T", "void 0", false},
		"empty-array":             {"other: readonly T[]", "[]", false},
		"empty-readonly-array":    {"other: readonly T[]", "[] as const", false},
		"two-calls":               {"other: T", "load(2)", true},
		"two-parenthesized-calls": {"other: T", "(load(2))", true},
	}
	keys := slices.Sorted(maps.Keys(shapes))
	for _, key := range keys {
		f.Add([]byte(key))
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := string(data)
		shape, ok := shapes[key]
		if !ok {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
			shape = shapes[key]
		}
		source := legacyGenericHelpers + "function check<T>(actual: T, " + shape.parameter + "): boolean { return true }\nexport effect function main(): boolean!! { return check(load(1), " + shape.argument + ") }\n"
		before := legacyCompile(t, env, map[string]string{"main.vibe": source})
		defer before.Remove()
		config := toolsConfig(env.w, before.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatal("invalid test configuration")
		}
		var result *vibelang.FixResult
		Within("fix", func() {
			result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		})
		if result.Err != nil || len(result.Refused) > 0 {
			Gap(t, "FuzzVIPGenericSiblingEvidence", key, "migration refused: %v %+v", result.Err, result.Refused)
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		if !strings.Contains(fixed, "check(try load(1),") || shape.two && !strings.Contains(fixed, "try load(2)") {
			Gap(t, "FuzzVIPGenericSiblingEvidence", key, "context inferred from a weak sibling left a legacy call unrun:\n%s", fixed)
		}
		after := legacyCompile(t, env, map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPGenericSiblingEvidence", key, "migration adds errors: %v", errors)
		}
		ExpectPending(t, "FuzzVIPGenericSiblingEvidence", key)
		ExpectPending(t, "FuzzVIPGenericSiblingEvidence", specCorpusKey(t))
	})
}
