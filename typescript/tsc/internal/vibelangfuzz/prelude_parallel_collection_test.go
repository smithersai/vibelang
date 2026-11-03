package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"maps"
	"path/filepath"
	"strings"
	"testing"
)

const preludeParallelCollectionQuote = "Every `.vibe` module has a declaration, its sidecar, so `noEmit` and `declaration: false` change nothing here."

func TestPreludeParallelCollectionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), preludeParallelCollectionQuote) {
		t.Fatal("Chapter7 declaration-coverage quote changed")
	}
}
func FuzzPreludeParallelCollection(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"2:inferred", "4:inferred", "8:inferred", "2:written", "4:written", "8:written"} {
		f.Add([]byte(key))
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestPreludeParallelCollectionQuoted(t)
		key := string(data)
		count := 4
		written := strings.HasSuffix(key, ":written")
		switch {
		case strings.HasPrefix(key, "2:"):
			count = 2
		case strings.HasPrefix(key, "8:"):
			count = 8
		case len(data) > 0 && !strings.HasPrefix(key, "4:"):
			count = 2 + int(data[0])%15
		}
		files := map[string]string{}
		var names []string
		for i := range count {
			name := fmt.Sprintf("module%d.vibe", i)
			names = append(names, name)
			annotation := ""
			if written {
				annotation = ": Effect.Effect<number>"
			}
			files[name] = fmt.Sprintf("// Documented Effect import.\nimport { Effect } from \"effect\"\nexport function answer%d(n: number)%s { return Effect.succeed(n + %d) }\n", i, annotation, i)
		}
		listed, _ := json.Marshal(names)
		config := `{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"ES2022","module":"NodeNext","declaration":true,"outDir":"out"},"files":` + string(listed) + "}"
		var first map[string]string
		for round := range 2 {
			before, err := env.w.Compile(t.Context(), Project{Files: files, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer before.Remove()
			parsed := toolsConfig(env.w, before.Dir)
			var result *vibelang.FixResult
			Within("fix", func() {
				result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), parsed, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, "FuzzPreludeParallelCollection", key, "prelude rewrite failed: %v", result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[filepath.Base(name.AsString())] = file.Text
			}
			if round == 0 {
				first = fixed
			} else if !maps.Equal(first, fixed) {
				Gap(t, "FuzzPreludeParallelCollection", key, "identical input produced different rewrites")
			}
			after, err := env.w.Compile(t.Context(), Project{Files: fixed, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer after.Remove()
			if errors := legacyErrors(after); len(errors) > 0 {
				Gap(t, "FuzzPreludeParallelCollection", key, "rewritten project errors: %v", errors)
			}
			for i := range count {
				output := fmt.Sprintf("out/module%d.d.ts", i)
				if !strings.Contains(after.Outputs[output], fmt.Sprintf("answer%d", i)) {
					Gap(t, "FuzzPreludeParallelCollection", key, "missing declaration %s", output)
				}
			}
		}
		ExpectPending(t, "FuzzPreludeParallelCollection", key)
		ExpectPending(t, "FuzzPreludeParallelCollection", specCorpusKey(t))
	})
}
