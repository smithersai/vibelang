package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzDeclarationNamespaceShadow checks declaration output where an inferred
// type reuses a type another module wrote, and the declaring module binds the
// written name to something else. util writes `x: Option<number>` with
// `import type { Option } from "effect/Option"`; main infers a type from
// util's function while it imports `* as Option from "effect/Option"`, so in
// main's declarations the interface must be written `Option.Option<number>`,
// as tsc writes it for the TypeScript twin. Chapter 1 makes declaration
// output API-identical to what tsc writes for the twin. Each cell compiles
// the .vibe pair and its .ts twin, checks that both declaration outputs
// type-check as written, and that main's export has the same type in both.
// The key names the module, main's binding of the name, util's annotation
// and how main uses util's function. Projects emit one file at a time
// (singleThreaded): with parallel emit, util's declarations also depend on
// whether main was emitted first, a nondeterminism no oracle can pin.

const namespaceShadowTarget = "FuzzDeclarationNamespaceShadow"

var namespaceShadowQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin: the same exported names, each export's type identical to `tsc`'s in both directions (a type-level check)"},
	{"001-functions.md", "Synthesized import types use TypeScript’s spelling for the twin under the same imports and tsconfig."},
}

type namespaceShadowModule struct {
	key, specifier, name, typ string
	file                      string // a local module's source, empty for a package
}

var namespaceShadowModules = []namespaceShadowModule{
	{key: "option", specifier: "effect/Option", name: "Option", typ: "Option<number>"},
	{key: "duration", specifier: "effect/Duration", name: "Duration", typ: "Duration"},
	{key: "httpclient", specifier: "effect/http/HttpClient", name: "HttpClient", typ: "HttpClient"},
	{key: "local", specifier: "./box.js", name: "Box", typ: "Box", file: "export interface Box { readonly value: number }\nexport declare const Box: { readonly key: \"Box\" }\n"},
}

// main's binding of the name util writes.
var namespaceShadowBindings = map[string]string{
	"namespace":       "import type * as %N from \"%P\"\n",
	"namespace-value": "import * as %N from \"%P\"\nexport type Keep = typeof %N\n",
	"other-namespace": "import type * as Other from \"%P\"\nexport type Keep = Other.%T\n",
	"none":            "",
}

// util's annotations of the name.
var namespaceShadowShapes = map[string]string{
	"param-return": "export const wrap = (token: string) => (x: %T): %T => x\n",
	"union":        "export const wrap = (token: string) => (xs: ReadonlyArray<%T | string>): number => xs.length\n",
	"generic":      "export const wrap = (token: string) => <Z>(x: %T, z: Z): [%T, Z] => [x, z]\n",
	"object":       "export const wrap = (token: string) => (x: %T) => ({ value: x })\n",
}

// how main uses util's function.
var namespaceShadowUses = map[string]string{
	"property": "export const make = (t: string) => ({ run: wrap(t) })\n",
	"return":   "export const make = (t: string) => wrap(t)\n",
	"const":    "export const make = wrap(\"t\")\n",
}

type namespaceShadowCase struct {
	key                 string
	module              namespaceShadowModule
	binding, shape, use string
}

func namespaceShadowCases() []namespaceShadowCase {
	var cases []namespaceShadowCase
	for _, m := range namespaceShadowModules {
		for _, b := range slices.Sorted(maps.Keys(namespaceShadowBindings)) {
			for _, s := range slices.Sorted(maps.Keys(namespaceShadowShapes)) {
				for _, u := range slices.Sorted(maps.Keys(namespaceShadowUses)) {
					cases = append(cases, namespaceShadowCase{key: m.key + "/" + b + "/" + s + "/" + u, module: m, binding: b, shape: s, use: u})
				}
			}
		}
	}
	return cases
}

func (c namespaceShadowCase) fill(text string) string {
	return strings.NewReplacer("%N", c.module.name, "%P", c.module.specifier, "%T", c.module.typ).Replace(text)
}

// sources is the project with util and main in extension ext.
func (c namespaceShadowCase) sources(ext string) map[string]string {
	files := map[string]string{
		"package.json": `{"type":"module"}`,
		"util." + ext:  c.fill("import type { %N } from \"%P\"\n" + namespaceShadowShapes[c.shape]),
		"main." + ext:  c.fill(namespaceShadowBindings[c.binding]) + "import { wrap } from \"./util.js\"\n" + namespaceShadowUses[c.use],
	}
	if c.module.file != "" {
		files["box.ts"] = c.module.file
	}
	return files
}

// namespaceShadowConfig is DefaultConfig with every source listed, emitting
// one file at a time: parallel declaration emit makes util's output depend
// on whether main was emitted first.
func namespaceShadowConfig(files map[string]string) string {
	var names []string
	for name := range files {
		if isSource(name) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	listed, _ := json.Marshal(names)
	config := strings.Replace(DefaultConfig, `"target": "ES2022",`, `"target": "ES2022",
    "singleThreaded": true,`, 1)
	return strings.TrimSuffix(config, "\n}") + ",\n  \"files\": " + string(listed) + "\n}"
}

// declarations compiles the project and returns main's and util's
// declarations, or the compile's errors.
func (c namespaceShadowCase) declarations(t *testing.T, w *Workspace, ext string) (map[string]string, []string, map[string]string) {
	t.Helper()
	files := c.sources(ext)
	r, err := w.Compile(t.Context(), Project{Files: files, Config: namespaceShadowConfig(files)})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var problems []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			problems = append(problems, describe(d))
		}
	}
	out := map[string]string{}
	for _, name := range []string{"main", "util", "box"} {
		if text, ok := r.Outputs["out/"+name+".d.ts"]; ok {
			out[name] = text
		}
	}
	return out, problems, files
}

// consumer places declaration outputs as .ts files, so that skipLibCheck
// does not hide their errors: the .vibe output of one module beside the
// twin's output of the other, so each module's declarations are judged on
// their own, and the twin's pair. check.ts compares the module's export
// with the twin's.
func namespaceShadowConsumer(module string, vibe, twin map[string]string, local string) map[string]string {
	files := map[string]string{"package.json": `{"type":"module"}`}
	for name, text := range twin {
		files["twin/"+name+".ts"] = text
		files["vibe/"+name+".ts"] = text
	}
	files["vibe/"+module+".ts"] = vibe[module]
	if local != "" {
		files["vibe/box.ts"] = local
		files["twin/box.ts"] = local
	}
	export := map[string]string{"main": "make", "util": "wrap"}[module]
	files["check.ts"] = `import * as V from "./vibe/` + module + `.js"
import * as T from "./twin/` + module + `.js"
type Same<X, Y> = (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? true : false
export const same: Same<typeof V.` + export + `, typeof T.` + export + `> = true
`
	return files
}

func checkNamespaceShadow(t *testing.T, w *Workspace, c namespaceShadowCase) {
	t.Helper()
	twin, twinProblems, _ := c.declarations(t, w, "ts")
	if len(twinProblems) > 0 || twin["main"] == "" || twin["util"] == "" {
		t.Fatalf("the TypeScript twin of %s does not compile: %s", c.key, strings.Join(twinProblems, "; "))
	}
	vibe, problems, files := c.declarations(t, w, "vibe")
	if len(problems) > 0 || vibe["main"] == "" || vibe["util"] == "" {
		Gap(t, namespaceShadowTarget, c.key, "Chapter 1: the .vibe pair of %s does not compile as its twin does: %s\n%s", c.key, strings.Join(problems, "; "), Archive(files))
		return
	}
	for _, module := range []string{"main", "util"} {
		// Every annotation and use behaves alike for one module and
		// binding, so a gap is keyed by those: main:option/namespace.
		key := module + ":" + c.module.key + "/" + c.binding
		r, err := w.Compile(t.Context(), Project{Files: namespaceShadowConsumer(module, vibe, twin, c.module.file)})
		if err != nil {
			t.Fatal(err)
		}
		var errs []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errs = append(errs, describe(d))
			}
		}
		r.Remove()
		if len(errs) > 0 {
			Gap(t, namespaceShadowTarget, key, "Chapter 1 API identity: %s's declarations do not type-check or differ from the twin's: %s\nvibe %s.d.ts:\n%s\ntwin %s.d.ts:\n%s\n%s", module, strings.Join(errs, "; "), module, vibe[module], module, twin[module], Archive(files))
			continue
		}
		ExpectPending(t, namespaceShadowTarget, key)
	}
}

func TestDeclarationNamespaceShadowQuoted(t *testing.T) {
	for _, q := range namespaceShadowQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
}

// TestDeclarationNamespaceShadowWitness compiles the alchemy minimum:
// HttpClientUtils writes the HttpClient interface in a returned arrow's
// parameter, and K2Http, which imports effect/http/HttpClient as the
// namespace HttpClient, stores that arrow in an object it infers.
func TestDeclarationNamespaceShadowWitness(t *testing.T) {
	TestDeclarationNamespaceShadowQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-k2-inferred-namespace-alias.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Key string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	cases := namespaceShadowCases()
	i := slices.IndexFunc(cases, func(c namespaceShadowCase) bool { return c.key == witness.Key })
	if i < 0 {
		t.Fatalf("%s names no cell %q", witness.Source, witness.Key)
	}
	checkNamespaceShadow(t, NewWorkspace(t), cases[i])
}

func FuzzDeclarationNamespaceShadow(f *testing.F) {
	startShortBudget(f)
	cases := namespaceShadowCases()
	for _, key := range []string{"httpclient/namespace/param-return/property", "option/namespace-value/generic/return", "duration/other-namespace/union/const", "local/namespace/object/property"} {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestDeclarationNamespaceShadowQuoted(t)
		i := slices.IndexFunc(cases, func(c namespaceShadowCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkNamespaceShadow(t, w, cases[i])
		ExpectPending(t, namespaceShadowTarget, specCorpusKey(t))
	})
}

func TestDeclarationNamespaceShadowNeighborhood(t *testing.T) {
	if testing.Short() && os.Getenv("VIBELANG_NAMESPACE_SHADOW_MATRIX") == "" {
		t.Skip("the complete module, binding, annotation and use matrix runs separately")
	}
	TestDeclarationNamespaceShadowQuoted(t)
	w := NewWorkspace(t)
	for _, c := range namespaceShadowCases() {
		t.Run(c.key, func(t *testing.T) { checkNamespaceShadow(t, w, c) })
	}
}
