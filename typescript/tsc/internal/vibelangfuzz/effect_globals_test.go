package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const effectGlobalsTarget = "FuzzEffectGlobals"

// VIP-6; alchemy-6 and alchemy-11.
const effectGlobalsQuote = "Every export of Effect's `Effect` module is a global variable in a `.vibe` file: `retry`, `sleep`, `log`, `all`, `race`, `tryPromise`, `sync`, `callback`, `map`, and so on. A local declaration or import shadows one, as with any global."
const effectGlobalsClashQuote = "A name that clashes is not a global, and is used as `Effect.x` instead."

func TestEffectGlobalsQuoted(t *testing.T) {
	vip := SpecText("../vips/0006-effect-globals.md")
	for _, quote := range []string{effectGlobalsQuote, effectGlobalsClashQuote} {
		if !strings.Contains(vip, quote) {
			t.Fatalf("VIP-6 no longer says %q", quote)
		}
	}
}

// effectGlobalNames are exports of effect/Effect that clash with nothing: not
// reserved words, not JavaScript globals, not VibeLang keywords. The native
// control proves each one exists in the pinned Effect.
func effectGlobalNames() []string {
	return []string{
		"retry", "sleep", "log", "all", "race", "tryPromise", "sync", "callback", "map",
		"currentParentSpan", "serviceOption", "scoped", "onExit",
		"succeed", "fail", "gen", "suspend", "forEach", "timeout", "andThen", "flatMap", "tap",
		"catchTag", "acquireRelease", "ensuring", "interrupt", "never", "die", "logInfo",
	}
}

func effectGlobalsProgram(name string, shadow, native bool) string {
	if shadow {
		return "const " + name + " = 1;\nexport const probe: number = " + name + ";\n"
	}
	if native {
		return "import * as Effect from \"effect/Effect\";\nexport const probe = Effect." + name + ";\n"
	}
	return "export const probe = " + name + ";\n"
}

// Every non-clashing export of effect/Effect resolves unqualified in a .vibe
// file, and a local declaration shadows it. The oracle expects no diagnostic;
// the TypeScript control reads the same export through the module.
func FuzzEffectGlobals(f *testing.F) {
	startShortBudget(f)
	names := effectGlobalNames()
	for _, name := range names {
		f.Add(name, uint8(0))
		f.Add(name, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, kind uint8) {
		TestEffectGlobalsQuoted(t)
		if !slices.Contains(names, name) {
			if name == "" {
				return
			}
			name = names[int(name[0])%len(names)]
		}
		shadow := kind&1 != 0
		key := fmt.Sprintf("%s:%s", map[bool]string{false: "global", true: "shadow"}[shadow], name)
		for _, native := range []bool{true, false} {
			source := effectGlobalsProgram(name, shadow, native)
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "check Effect global", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if !HasError(result.Diagnostics) {
				continue
			}
			if native {
				t.Fatalf("invalid native Effect export control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			Gap(t, effectGlobalsTarget, key, "VIP-6: every non-clashing effect/Effect export is a global (shadow=%t), got %v\n%s", shadow, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, effectGlobalsTarget, key)
		ExpectPending(t, effectGlobalsTarget, specCorpusKey(t))
	})
}
