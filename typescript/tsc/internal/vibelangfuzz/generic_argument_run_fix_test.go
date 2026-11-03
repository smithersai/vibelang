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

const genericArgumentRunFixQuote = "Batch `--fix` chooses only `try` and refuses an edit that adds an error."

func TestGenericArgumentRunFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), genericArgumentRunFixQuote) {
		t.Fatal("Chapter 7 no longer contains the inferred-argument fix rule")
	}
}

func FuzzGenericArgumentRunFix(f *testing.F) {
	startShortBudget(f)
	shapes := map[string]struct {
		declaration, call string
		run               bool
	}{
		"smithers-expect-awaited": {"function take<T>(x: T, message?: string): number { return 1 }", "take(job)", true},
		"first":                   {"function take<T>(x: T, n: number): number { return n }", "take(job, 1)", true},
		"last":                    {"function take<T>(n: number, x: T): number { return n }", "take(1, job)", true},
		"constraint":              {"function take<T extends unknown>(x: T): number { return 1 }", "take(job)", true},
		"overload":                {"function take<T>(x: T): number; function take(x: unknown): number { return 1 }", "take(job)", true},
		"method":                  {"const box = { take<T>(x: T): number { return 1 } }", "box.take(job)", true},
		"array":                   {"function take<T>(x: T[]): number { return 1 }", "take([job])", false},
		"callback":                {"function take<T>(x: () => T): number { return 1 }", "take(() => job)", false},
		"explicit":                {"function take<T>(x: T): number { return 1 }", "take<number!!>(job)", false},
		"returned-data":           {"", "job", false},
	}
	keys := slices.Sorted(maps.Keys(shapes))
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte("vip:" + key))
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestGenericArgumentRunFixQuoted(t)
		key := string(data)
		vip := strings.HasPrefix(key, "vip:")
		key = strings.TrimPrefix(key, "vip:")
		shape, ok := shapes[key]
		if !ok {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
			shape = shapes[key]
		}
		source := shape.declaration + "\nexport effect function main(job: number!!) { return " + shape.call + " }\n"
		before := legacyCompile(t, env, map[string]string{"main.vibe": source})
		defer before.Remove()
		config := toolsConfig(env.w, before.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatal("invalid test configuration")
		}
		var result *vibelang.FixResult
		Within("fix", func() {
			result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: vip})
		})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		want := source
		if shape.run && !vip {
			want = strings.Replace(source, shape.call, strings.Replace(shape.call, "job", "try job", 1), 1)
		}
		if vip {
			key = "vip:" + key
		}
		if fixed != want {
			Gap(t, "FuzzGenericArgumentRunFix", key, "Chapter7 inferred argument repair: got\n%s\nwant\n%s", fixed, want)
		}
		after := legacyCompile(t, env, map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzGenericArgumentRunFix", key, "repair adds errors: %v", errors)
		}
		ExpectPending(t, "FuzzGenericArgumentRunFix", key)
		ExpectPending(t, "FuzzGenericArgumentRunFix", specCorpusKey(t))
	})
}
