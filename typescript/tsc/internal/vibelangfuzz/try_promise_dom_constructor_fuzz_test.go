package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const tryPromiseDOMTarget = "FuzzEffectTryPromiseDOMConstructors"

func TestEffectTryPromiseDOMConstructorsQuoted(t *testing.T) { domConstructorsQuoted(t) }

// Chapter 7 requires preservation of constructor bindings during repair.
// Chapter 5 still bans host constructors after repair; this oracle never
// treats qualification with globalThis as permission to bypass the platform.
func FuzzEffectTryPromiseDOMConstructors(f *testing.F) {
	startShortBudget(f)
	domConstructorsQuoted(f)
	var keys []string
	for _, name := range []string{"Headers", "Response", "URL"} {
		for _, form := range []string{"expression", "block", "conditional", "named-import", "global"} {
			key := name + "/" + form
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := strings.TrimPrefix(string(data), "key:")
		if !slices.Contains(keys, key) {
			index := 0
			if len(data) != 0 {
				index = int(data[0]) % len(keys)
			}
			key = keys[index]
		}
		parts := strings.Split(key, "/")
		name, form := parts[0], parts[1]
		parameter := "input: string"
		if name == "Headers" {
			parameter = "input: Readonly<Record<string, string>>"
		}
		constructor := "new " + name + "(input)"
		if form == "global" {
			constructor = "new globalThis." + name + "(input)"
		}
		thunk := "() => Promise.resolve(" + constructor + ")"
		if form == "block" {
			thunk = "() => { const value = " + constructor + "; return Promise.resolve(value) }"
		}
		call := "Effect.tryPromise(" + thunk + ")"
		if form == "conditional" {
			call = "input ? " + call + " : Effect.succeed(undefined)"
		}
		imports := "import * as Effect from \"effect/Effect\"\n"
		if form == "named-import" {
			imports = "import { Effect } from \"effect\"\n"
		}
		source := imports + "export const make = (" + parameter + ") => " + call + "\n"
		twin := toolsCompile(t, w, tryPromiseDOMTarget, map[string]string{"main.ts": source})
		defer twin.Remove()
		if HasError(twin.Diagnostics) {
			t.Fatalf("invalid TypeScript constructor twin: %v\n%s", SortedKeys(Keys(twin.Dir, twin.Diagnostics)), source)
		}
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, tryPromiseDOMTarget, files)
		defer before.Remove()
		fixed := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir))
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		afterFiles := maps.Clone(files)
		for path, file := range fixed.Files {
			afterFiles[strings.TrimPrefix(path.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		after := toolsCompile(t, w, tryPromiseDOMTarget, afterFiles)
		defer after.Remove()
		hasBan := false
		for _, d := range after.Diagnostics {
			if d.Code() == 4402 && d.Source() == "EK" {
				hasBan = true
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				Gap(t, tryPromiseDOMTarget, key, "%s: constructor gained an error: %s\n%s", domConstructorFixQuote, d.String(), afterFiles["main.vibe"])
				return
			}
		}
		if hasBan != (name != "URL") {
			Gap(t, tryPromiseDOMTarget, key, "%s: EK4402=%t, constructor=%s\n%s", domConstructorBanQuote, hasBan, name, afterFiles["main.vibe"])
			return
		}
		ExpectPending(t, tryPromiseDOMTarget, key)
	})
}
