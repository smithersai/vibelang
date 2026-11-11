package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effectglobals"
)

const moduleNameEffectGlobalTarget = "FuzzModuleNameEffectGlobal"

// VIP-40 lists the bindings a module name collides with; chapter 1 keeps a
// file's scope independent of its implicit Effect uses; VIP-6 lets a local
// declaration shadow an Effect global.
const moduleNameBindingQuote = "The name redeclares a binding of the file: a `const`, function, class, import or another module"
const moduleNameScopeQuote = "Adding or removing an implicit Effect use cannot change either file's scope."

func TestModuleNameEffectGlobalQuoted(t *testing.T) {
	for _, quote := range []struct{ chapter, text string }{
		{"../vips/0040-module-declarations.md", moduleNameBindingQuote},
		{"001-functions.md", moduleNameScopeQuote},
		{"../vips/0006-effect-globals.md", effectGlobalsShadowQuote},
	} {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

// The shapes of a FuzzModuleNameEffectGlobal input, by key. "module" declares
// only the module. "const", "twice" and "import" add a binding of the file
// that VIP-40 names: a const, a second module, or an import. The nested shapes
// add a binding of the name in a nested scope, which shadows the module there
// and redeclares nothing: "local" a const in a function, "param" a parameter,
// "typelit" a parameter of a function type. "object" adds an object literal
// inside a function and "destructured" a destructured parameter, which bind
// no such name at all.
var moduleNameShapes = []string{"module", "const", "twice", "import", "local", "param", "typelit", "object", "destructured"}

// moduleNameRedeclares reports whether a shape binds the name at the file's
// top level, which makes the module name EK4005.
func moduleNameRedeclares(shape string) bool {
	return shape == "const" || shape == "twice" || shape == "import"
}

// moduleNameRoots are effect root modules, which a .vibe file also sees
// without an import (chapter 5, Effect's modules are in scope).
var moduleNameRoots = []string{"Duration", "Option", "Stream", "Schedule", "Ref", "Layer", "Schema"}

// moduleNameCandidates are the names the target draws from: every Effect
// global (each non-clashing export of effect/Effect) and the root modules.
func moduleNameCandidates() []string {
	var names []string
	for _, name := range effectglobals.Exports {
		if effectglobals.Clash(name) == "" {
			names = append(names, name)
		}
	}
	return append(names, moduleNameRoots...)
}

// moduleNameProject is the program of one shape for name. With use, the file
// also calls an unrelated Effect global, which makes it resolve Effect.
func moduleNameProject(name, shape string, use bool) Project {
	var source strings.Builder
	files := map[string]string{}
	switch shape {
	case "const":
		fmt.Fprintf(&source, "const %s = 0\nexport const probe = %s\n", name, name)
	case "import":
		files["m.ts"] = "export const value = 0\n"
		fmt.Fprintf(&source, "import { value as %s } from \"./m.js\"\nexport const probe = %s\n", name, name)
	case "twice":
		fmt.Fprintf(&source, "module %s { export const other = 0 }\n", name)
	case "local":
		fmt.Fprintf(&source, "export function shadow() { const %s = 1; return %s }\n", name, name)
	case "param":
		fmt.Fprintf(&source, "export function shadow(%s: number) { return %s }\n", name, name)
	case "typelit":
		fmt.Fprintf(&source, "type Shadow = { f?: (%s: number) => boolean }\nexport const shadow: Shadow = {}\n", name)
	case "object":
		source.WriteString("export function shadow(a: number) { return { a } }\n")
	case "destructured":
		source.WriteString("export function shadow({ a = 1 }: { a?: number }) { return a }\n")
	}
	fmt.Fprintf(&source, "module %s { export const label = \"body\" }\nimport { label } from %s\nexport const message = label\n", name, name)
	if use {
		global := "succeed"
		if name == global {
			global = "fail"
		}
		fmt.Fprintf(&source, "export const ready = %s(message)\n", global)
	}
	files["main.vibe"] = source.String()
	return Project{Files: files}
}

// compileModuleName returns the sorted keys of the project's diagnostics.
func compileModuleName(t *testing.T, w *Workspace, project Project) []DiagnosticKey {
	t.Helper()
	var result *Result
	var err error
	within(t, "check module name", func() { result, err = w.Compile(t.Context(), project) })
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	return SortedKeys(Keys(result.Dir, result.Diagnostics))
}

func hasEK4005(keys []DiagnosticKey) bool {
	return slices.ContainsFunc(keys, func(k DiagnosticKey) bool { return k.Source == "EK" && k.Code == 4005 })
}

// A module named after an Effect global or root module compiles alike with and
// without an unrelated Effect use, and is never EK4005 for that name, whatever
// nested scopes bind it; a const, a second module or an import of the name at
// the top level is EK4005 either way. The oracles
// are the three quotes above; the with-use and without-use programs are the
// compiler against itself on inputs chapter 1 says must agree.
func FuzzModuleNameEffectGlobal(f *testing.F) {
	startShortBudget(f)
	for _, name := range []string{"context", "sleep", "succeed", "Duration"} {
		for _, shape := range moduleNameShapes {
			f.Add(name, shape)
		}
	}
	names := moduleNameCandidates()
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, shape string) {
		TestModuleNameEffectGlobalQuoted(t)
		if !slices.Contains(names, name) {
			if name == "" {
				return
			}
			name = names[int(name[0])%len(names)]
		}
		if !slices.Contains(moduleNameShapes, shape) {
			if shape == "" {
				return
			}
			shape = moduleNameShapes[int(shape[0])%len(moduleNameShapes)]
		}
		key := shape + ":" + name
		bare := compileModuleName(t, w, moduleNameProject(name, shape, false))
		used := compileModuleName(t, w, moduleNameProject(name, shape, true))
		if !moduleNameRedeclares(shape) {
			if hasEK4005(bare) || hasEK4005(used) {
				Gap(t, moduleNameEffectGlobalTarget, key, "VIP-40: module %s beside a %s shape redeclares no binding of the file\nwithout a use: %v\nwith a use: %v", name, shape, bare, used)
			}
		} else if !hasEK4005(bare) || !hasEK4005(used) {
			Gap(t, moduleNameEffectGlobalTarget, key, "VIP-40: module %s beside a %s of its name is EK4005\nwithout a use: %v\nwith a use: %v", name, shape, bare, used)
		}
		if !slices.Equal(bare, used) {
			Gap(t, moduleNameEffectGlobalTarget, key, "chapter 1: an implicit Effect use cannot change the file's scope\nwithout a use: %v\nwith a use: %v", bare, used)
		}
		ExpectPending(t, moduleNameEffectGlobalTarget, key)
		ExpectPending(t, moduleNameEffectGlobalTarget, specCorpusKey(t))
	})
}

// TestModuleNameEffectGlobalEveryName declares a module named after every
// candidate in one file that uses succeed, each beside a function whose
// parameter shadows it and which returns an object literal: the census of the
// target's module and param shapes over the whole list, never a chosen sample. succeed itself stays out,
// since the file calls it; the fuzz target covers it with fail.
func TestModuleNameEffectGlobalEveryName(t *testing.T) {
	var names []string
	for _, name := range moduleNameCandidates() {
		if name != "succeed" && !slices.Contains(names, name) {
			names = append(names, name)
		}
	}
	if len(names) < 200 {
		t.Fatalf("only %d candidate names", len(names))
	}
	// Each module starts at its own offset, so a diagnostic's position names
	// the module it is about.
	var source strings.Builder
	starts := make([]int, len(names))
	for i, name := range names {
		starts[i] = source.Len()
		fmt.Fprintf(&source, "module %s { export const label = %d }\nimport { label as label%d } from %s\nexport function shadow%d(%s: number) { return { %s } }\n", name, i, i, name, i, name, name)
	}
	source.WriteString("export const ready = succeed(label0)\n")
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
				Gap(t, moduleNameEffectGlobalTarget, "every-name:"+name, "VIP-40: module %s redeclares no binding of the file, got %v", name, keys)
			}
		})
	}
}
