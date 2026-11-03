package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const platformTypeOnlyImportQuote = "`import type { Stats } from \"node:fs\"` is allowed because it is erased."

func TestPlatformTypeOnlyImportQuoted(t *testing.T) { platformTypeOnlyImportQuoted(t) }
func platformTypeOnlyImportQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), platformTypeOnlyImportQuote) {
		t.Fatalf("chapter 5 no longer says %q", platformTypeOnlyImportQuote)
	}
}

var platformTypeOnlyImportSources = map[string]struct {
	source string
	fixes  bool
}{
	"type":      {`import { Store } from "node:async_hooks"; export type C = Store`, true},
	"alias":     {`import { Store as S } from "node:async_hooks"; export type C = S`, true},
	"namespace": {`import * as H from "node:async_hooks"; export type C = H.Store`, true},
	"typeof":    {`import { Store } from "node:async_hooks"; export type C = typeof Store`, true},
	"new":       {`import { Store } from "node:async_hooks"; export const c = new Store()`, false},
	"mixed":     {`import { Store } from "node:async_hooks"; export const c: Store = new Store()`, false},
	"reexport":  {`import { Store } from "node:async_hooks"; export { Store }`, false},
	"shorthand": {`import { Store } from "node:async_hooks"; export const c = { Store }`, false},
}

// FuzzPlatformTypeOnlyImport: a builtin import no code reads as a value becomes
// import type, which then compiles clean; any value read keeps EK4402.
func FuzzPlatformTypeOnlyImport(f *testing.F) {
	startShortBudget(f)
	platformTypeOnlyImportQuoted(f)
	keys := slices.Sorted(maps.Keys(platformTypeOnlyImportSources))
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x01"))
		f.Add([]byte(key + "\x00\x02"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = "type"
		}
		chosen := platformTypeOnlyImportSources[key]
		source := chosen.source
		if len(parts) == 2 && len(parts[1]) > 0 {
			if parts[1][0]&1 != 0 {
				source = "// retained trivia\n" + source
			}
			if parts[1][0]&2 != 0 {
				source = strings.ReplaceAll(source, `"`, `'`)
			}
		}
		files := map[string]string{
			"main.vibe":    source + "\n",
			"package.json": `{"name":"platform-type-only-import","type":"module"}`,
			"host.d.ts":    "declare module \"node:async_hooks\" { export class Store { id: number } }\n",
		}
		before := toolsCompile(t, w, "FuzzPlatformTypeOnlyImport", files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if config == nil {
			t.Fatal("missing fix project")
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		rewritten := strings.Contains(fixed["main.vibe"], "import type")
		if rewritten != chosen.fixes {
			Gap(t, "FuzzPlatformTypeOnlyImport", key, "import type written=%v, want %v; refused %+v; before %v:\n%s", rewritten, chosen.fixes, result.Refused, before.Diagnostics, fixed["main.vibe"])
			return
		}
		if chosen.fixes {
			after := toolsCompile(t, w, "FuzzPlatformTypeOnlyImport", fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, "FuzzPlatformTypeOnlyImport", key, "the fixed program has errors: %v\n%s", after.Diagnostics, fixed["main.vibe"])
				return
			}
		}
		ExpectPending(t, "FuzzPlatformTypeOnlyImport", key)
	})
}
