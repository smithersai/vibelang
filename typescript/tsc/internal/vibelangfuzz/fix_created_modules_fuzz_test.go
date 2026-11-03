package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const fixCreatedModulesQuote = "The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet"

func TestFixCreatedModulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), fixCreatedModulesQuote) {
		t.Fatalf("005-services.md no longer says %q", fixCreatedModulesQuote)
	}
}

// Exercise module-resolution caches across successive adapter creations and
// verified writes. Chapter 5 requires the safe moves; Chapter 7's verified
// writes must leave the same result as a run that writes only at its end.
func FuzzFixCreatedModules(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"window", "performance", "crypto", "mixed"} {
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, count uint8) {
		TestFixCreatedModulesQuoted(t)
		const target = "FuzzFixCreatedModules"
		expressions := []string{"window.location.origin", "performance.now()", "crypto.getRandomValues(new Uint8Array(2))"}
		at := 0
		switch key {
		case "performance":
			at = 1
		case "crypto":
			at = 2
		case "window", "mixed":
		default:
			if len(key) > 0 {
				at = int(key[0]) % len(expressions)
			}
		}
		n := 1 + int(count%3)
		files := map[string]string{}
		for i := 0; i < n; i++ {
			expr := expressions[at]
			if key == "mixed" {
				expr = expressions[i%len(expressions)]
			}
			wrapper := "Effect.try(() => " + expr + ")"
			if i%2 != 0 {
				wrapper = "Effect.try({ try: () => " + expr + ", catch: (e) => e })"
			}
			files[fmt.Sprintf("m%d.vibe", i)] = "export effect function probe() { return try " + wrapper + "; }\n"
		}
		run := func(write bool) map[string]string {
			r := toolsCompile(t, w, target, files)
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if r.Program == nil || config == nil || len(config.Errors) != 0 {
				t.Fatal("invalid generated project")
			}
			options := vibelang.FixOptions{}
			if write {
				options.Verified = func(texts map[tspath.RootedFilePath]string) {
					for name, text := range texts {
						if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			var result *vibelang.FixResult
			within(t, "fix", func() { result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, options) })
			if result.Err != nil || len(result.Refused) != 0 {
				Gap(t, target, "fix:created-module:"+key, "safe adapter moves refused: err=%v refused=%v", result.Err, result.Refused)
			}
			fixed := maps.Clone(files)
			created := 0
			for name, file := range result.Files {
				rel, err := filepath.Rel(r.Dir, name.AsString())
				if err != nil {
					t.Fatal(err)
				}
				fixed[filepath.ToSlash(rel)] = file.Text
				if strings.HasSuffix(rel, ".ts") {
					created++
				}
			}
			if created != n {
				Gap(t, target, "fix:created-module:"+key, "got %d adapters for %d safe moves: %s", created, n, Archive(fixed))
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if HasError(after.Diagnostics) {
				Gap(t, target, "fix:created-module-import:"+key, "fixed imports must resolve: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
			}
			return fixed
		}
		dry, kept := run(false), run(true)
		if !reflect.DeepEqual(dry, kept) {
			Gap(t, target, "fix:created-module-write:"+key, "verified writes changed the result:\ndry:\n%s\nkept:\n%s", Archive(dry), Archive(kept))
		}
	})
}
