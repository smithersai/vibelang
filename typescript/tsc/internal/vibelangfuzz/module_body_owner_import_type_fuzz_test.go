package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const moduleBodyOwnerImportTypeTarget = "FuzzModuleBodyOwnerImportType"
const moduleBodyOwnerImportTypeQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestModuleBodyOwnerImportTypeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), moduleBodyOwnerImportTypeQuote) {
		t.Fatalf("Chapter 1 no longer says %q", moduleBodyOwnerImportTypeQuote)
	}
}

const moduleBodyOwnerConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"__identity_out","rootDir":"."},"files":[%s]}`

// moduleBodyOwnerCase is one owner whose module body declares a type the
// owner re-exports, and a consumer without a module body whose declaration
// infers that type. The TypeScript twin declares the body's bindings in the
// owner itself.
type moduleBodyOwnerCase struct {
	Source string            `json:"source"`
	Vibe   map[string]string `json:"vibe"`
	Twin   map[string]string `json:"twin"`
}

func moduleBodyOwnerVariant(key string, variant uint8) (string, moduleBodyOwnerCase) {
	declaration, maker, argument := "export interface Provider<A> { readonly value: A }", "export const make = <A>(value: A): Provider<A> => ({ value })", "1"
	switch key {
	case "alias":
		declaration, maker = `export type Provider<A> = { readonly value: A; readonly tag: "p" }`, `export const make = <A>(value: A): Provider<A> => ({ value, tag: "p" })`
	case "class":
		declaration, maker = "export class Provider<A> { constructor(readonly value: A) {} }", "export const make = <A>(value: A): Provider<A> => new Provider(value)"
	case "enum":
		declaration, maker, argument = "export enum Provider { On, Off }", "export const make = (on: boolean): Provider => on ? Provider.On : Provider.Off", "true"
	default:
		key = "interface"
	}
	body := "graph"
	if variant&2 != 0 {
		body = "platform"
	}
	reexport := "export * from " + body
	if variant&1 != 0 {
		reexport = "export { make, Provider } from " + body
	}
	owner := fmt.Sprintf("%s\n\nmodule %s {\n  %s\n\n  %s\n}\n", reexport, body, declaration, maker)
	twin := declaration + "\n\n" + maker + "\n"
	files := map[string]string{}
	var main string
	switch variant >> 2 & 3 {
	case 0:
		main = "import { make } from \"./lib.js\"\n\nexport const node = make(" + argument + ")\n"
	case 1:
		main = "import * as Lib from \"./lib.js\"\n\nexport const node = Lib.make(" + argument + ")\n"
	case 2:
		// The opencode shape: the consumer reaches the type through a module
		// that wraps the owner's function, and never imports the owner.
		files["mid.ts"] = "import { make } from \"./lib.js\"\n\nexport const wrap = (value: Parameters<typeof make>[0]) => make(value)\n"
		main = "import { wrap } from \"./mid.js\"\n\nexport const node = wrap(" + argument + ")\n"
	default:
		main = "import { make } from \"./lib.js\"\n\nexport function node() {\n  return make(" + argument + ")\n}\n"
	}
	c := moduleBodyOwnerCase{Vibe: map[string]string{"lib.vibe": owner, "main.vibe": main}, Twin: map[string]string{"lib.ts": twin, "main.ts": main}}
	for name, text := range files {
		c.Vibe[name], c.Twin[name] = text, text
	}
	return fmt.Sprintf("%s:%d", key, variant&15), c
}

func moduleBodyOwnerRoots(files map[string]string) string {
	roots := []string{}
	for _, name := range slices.Sorted(maps.Keys(files)) {
		roots = append(roots, fmt.Sprintf("%q", name))
	}
	return strings.Join(roots, ",")
}

// checkModuleBodyOwnerImportType compares the consumer's declaration with
// stock TypeScript's for the twin. The consumer has no module body, so only a
// generated @throws {never} may differ.
func checkModuleBodyOwnerImportType(t *testing.T, w *Workspace, tsc, gap string, c moduleBodyOwnerCase) {
	t.Helper()
	dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: c.Twin, Config: fmt.Sprintf(moduleBodyOwnerConfig, moduleBodyOwnerRoots(c.Twin))})
	defer os.RemoveAll(dir)
	candidate, err := w.CompileOrdered(t.Context(), Project{Files: c.Vibe, Config: fmt.Sprintf(moduleBodyOwnerConfig, moduleBodyOwnerRoots(c.Vibe))}, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer candidate.Remove()
	if HasError(candidate.Diagnostics) {
		Gap(t, moduleBodyOwnerImportTypeTarget, gap, "source rejected: %v\n%s", SortedKeys(Keys(candidate.Dir, candidate.Diagnostics)), Archive(c.Vibe))
		return
	}
	want, err := os.ReadFile(filepath.Join(dir, "__identity_out", "main.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	got, ok := candidate.Outputs["__identity_out/main.d.ts"]
	if !ok {
		t.Fatal("missing declaration for main")
	}
	if strings.ReplaceAll(got, "/** @throws {never} */\n", "") != string(want) {
		Gap(t, moduleBodyOwnerImportTypeTarget, gap, "%s\nstock TypeScript:\n%s\nVibeLang:\n%s\n%s", moduleBodyOwnerImportTypeQuote, want, got, Archive(c.Vibe))
	}
	ExpectPending(t, moduleBodyOwnerImportTypeTarget, gap)
}

// The minimized opencode pattern: a module whose graph body declares Provider
// and a consumer that reaches it only through a wrapper module.
func TestModuleBodyOwnerImportTypeCorpus(t *testing.T) {
	TestModuleBodyOwnerImportTypeQuoted(t)
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "opencode-layer-node-body-provider.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c moduleBodyOwnerCase
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	checkModuleBodyOwnerImportType(t, NewWorkspace(t), StockTypeScript(t), "corpus:opencode-layer-node-body-provider", c)
}

// Vary the body's type kind, the owner's re-export form and body name, and how
// the consumer reaches the type: a named import, a namespace import, a wrapper
// module, or an inferred function return.
func FuzzModuleBodyOwnerImportType(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"interface", "alias", "class", "enum"} {
		f.Add(key, uint8(0))
	}
	f.Add("interface", uint8(15))
	f.Add("class", uint8(9))
	w, tsc := NewWorkspace(f), StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestModuleBodyOwnerImportTypeQuoted(t)
		gap, c := moduleBodyOwnerVariant(key, variant)
		checkModuleBodyOwnerImportType(t, w, tsc, gap, c)
	})
}
