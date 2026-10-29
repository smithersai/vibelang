package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effectglobals"
)

const effectGlobalsTarget = "FuzzEffectGlobals"

// VIP-6; alchemy-6 and alchemy-11.
const effectGlobalsQuote = "Every export of Effect's `Effect` module is a global variable in a `.vibe` file"
const effectGlobalsClashQuote = "A name that clashes is not a global, and is used as `Effect.x` instead."
const effectGlobalsShadowQuote = "A local declaration or import shadows one, as with any global."
const effectGlobalsOffQuote = "An option in `tsconfig.json` turns the globals off"

func TestEffectGlobalsQuoted(t *testing.T) {
	vip := SpecText("../vips/0006-effect-globals.md")
	for _, quote := range []string{effectGlobalsQuote, effectGlobalsClashQuote, effectGlobalsShadowQuote, effectGlobalsOffQuote} {
		if !strings.Contains(vip, quote) {
			t.Fatalf("VIP-6 no longer says %q", quote)
		}
	}
}

// effectGlobalSeeds are the exports the short run compiles in every mode. The
// rest reach those modes through fuzzing, and TestEffectGlobalsEveryExport
// compiles each export bare. A clashing name tests the clash rule instead.
var effectGlobalSeeds = []string{
	"retry", "sleep", "log", "all", "race", "tryPromise", "sync", "callback", "map",
	"currentParentSpan", "serviceOption", "scoped", "onExit",
	"succeed", "fail", "gen", "suspend", "forEach", "timeout", "andThen", "flatMap", "tap",
	"catchTag", "acquireRelease", "ensuring", "interrupt", "never", "die", "logInfo",
	"yieldNow", "runPromise", "promise", "as", "fn", "Do", "Transaction", "exit",
	"try", "catch", "void", "let", "undefined", "match", "when", "service", "provide", "interruptible", "uninterruptible",
}

// The modes of a FuzzEffectGlobals input, by its kind byte. Corpus files keep
// their kinds, so a new mode goes last.
const (
	effectGlobalBare = iota
	effectGlobalLocal
	effectGlobalOff
	effectGlobalImport
	effectGlobalIdentity
	effectGlobalModulesOff
	effectGlobalModes
)

var effectGlobalModeNames = []string{"global", "shadow", "off", "import-shadow", "identity", "modules-off"}

// effectGlobalsConfig is the default configuration plus a vibe section.
func effectGlobalsConfig(vibe string) string {
	return strings.TrimSuffix(strings.TrimRight(DefaultConfig, "\n"), "\n}") + ",\n  \"vibe\": " + vibe + ",\n  \"include\": [\"*.vibe\", \"*.ts\"]\n}\n"
}

// effectGlobalsProject is the program of one mode. wantError says whether the
// oracle expects an error.
func effectGlobalsProject(name string, mode int) (project Project, wantError bool) {
	switch mode {
	case effectGlobalLocal:
		return Single("const " + name + " = 1;\nexport const probe: number = " + name + ";\n"), false
	case effectGlobalOff:
		return Project{
			Files:  map[string]string{"main.vibe": "export const probe = " + name + ";\n"},
			Config: effectGlobalsConfig(`{ "effectGlobals": false }`),
		}, true
	case effectGlobalImport:
		return Project{Files: map[string]string{
			"m.ts":      "const value = 1;\nexport { value as " + name + " };\n",
			"main.vibe": "import { " + name + " } from \"./m.ts\";\nexport const probe: number = " + name + ";\n",
		}}, false
	case effectGlobalIdentity:
		// The bare name is the export itself, not a like-named function: each
		// is assignable to the other.
		return Single("export const probe: typeof Effect." + name + " = " + name + ";\nexport const back: typeof " + name + " = Effect." + name + ";\n"), false
	case effectGlobalModulesOff:
		// vibe.effectGlobals and vibe.effectModules are separate switches.
		return Project{
			Files:  map[string]string{"main.vibe": "export const probe = " + name + ";\n"},
			Config: effectGlobalsConfig(`{ "effectModules": false }`),
		}, false
	}
	return Single("export const probe = " + name + ";\n"), false
}

// compileEffectGlobal returns the keys of the project's diagnostics when it
// has an error, and nil when it has none.
func compileEffectGlobal(t *testing.T, w *Workspace, project Project) []DiagnosticKey {
	t.Helper()
	var result *Result
	var err error
	within(t, "check Effect global", func() { result, err = w.Compile(t.Context(), project) })
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	if !HasError(result.Diagnostics) {
		return nil
	}
	return SortedKeys(Keys(result.Dir, result.Diagnostics))
}

// Every non-clashing export of effect/Effect resolves unqualified in a .vibe
// file; a local declaration or import shadows it; the option turns it off;
// and a clashing export is written Effect.x and never resolves bare. The
// oracles are VIP-6's sentences above. The native control compiles the export
// through its module, so each name the oracle holds to is in the pinned Effect.
func FuzzEffectGlobals(f *testing.F) {
	startShortBudget(f)
	for _, name := range effectGlobalSeeds {
		for mode := range effectGlobalModes {
			f.Add(name, uint8(mode))
		}
	}
	names := slices.Clone(effectglobals.Exports)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, kind uint8) {
		TestEffectGlobalsQuoted(t)
		if !slices.Contains(names, name) {
			if name == "" {
				return
			}
			name = names[int(name[0])%len(names)]
		}
		mode := int(kind) % effectGlobalModes
		native := compileEffectGlobal(t, w, Project{Files: map[string]string{"main.ts": "import * as Effect from \"effect/Effect\";\nexport const probe = Effect." + name + ";\n"}})
		if native != nil {
			t.Fatalf("invalid native Effect export control: %v\n%s", native, name)
		}
		key := fmt.Sprintf("%s:%s", effectGlobalModeNames[mode], name)
		if why := effectglobals.Clash(name); why != "" {
			key = "clash:" + name
			if qualified := compileEffectGlobal(t, w, Single("export const probe = Effect."+name+";\n")); qualified != nil {
				Gap(t, effectGlobalsTarget, key, "VIP-6: %s is %s, so it is used as Effect.%s; got %v", name, why, name, qualified)
			}
			if bare := compileEffectGlobal(t, w, Single("export const probe: typeof Effect."+name+" = "+name+";\n")); bare == nil {
				Gap(t, effectGlobalsTarget, key, "VIP-6: %s is %s, so it is not a global, but it resolved bare", name, why)
			}
		} else {
			project, wantError := effectGlobalsProject(name, mode)
			if got := compileEffectGlobal(t, w, project); (got != nil) != wantError {
				Gap(t, effectGlobalsTarget, key, "VIP-6: %s, want error %t, got %v\n%v", effectGlobalModeNames[mode], wantError, got, project.Files)
			}
		}
		ExpectPending(t, effectGlobalsTarget, key)
		ExpectPending(t, effectGlobalsTarget, specCorpusKey(t))
	})
}

// TestEffectGlobalsEveryExport compiles every non-clashing export of
// effect/Effect bare in one program: the census VIP-6's "every export" asks
// for, over the whole list and never a chosen sample.
func TestEffectGlobalsEveryExport(t *testing.T) {
	names := slices.Sorted(maps.Keys(effectglobals.Names))
	if len(names) < 200 {
		t.Fatalf("effectglobals.Names has only %d names", len(names))
	}
	// Each export's line starts at its own offset, so a diagnostic's position
	// names the export it is about.
	var source strings.Builder
	starts := make([]int, len(names))
	for i, name := range names {
		starts[i] = source.Len()
		fmt.Fprintf(&source, "export const probe%d = %s;\n", i, name)
	}
	w := NewWorkspace(t)
	result, err := w.Compile(t.Context(), Single(source.String()))
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	failed := map[string][]string{}
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		key := keyOf(result.Dir, d)
		if d.File() == nil || key.File != "main.vibe" {
			t.Fatalf("error outside the program: %v", key)
		}
		line, _ := slices.BinarySearch(starts, d.Pos()+1)
		failed[names[line-1]] = append(failed[names[line-1]], fmt.Sprint(key))
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			if keys := failed[name]; keys != nil {
				Gap(t, effectGlobalsTarget, "global:"+name, "VIP-6: every non-clashing effect/Effect export is a global, got %v", keys)
			}
		})
	}
}
