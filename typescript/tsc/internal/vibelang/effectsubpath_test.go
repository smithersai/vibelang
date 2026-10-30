package vibelang

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// installedEffect returns the directory of the installed effect package, or
// skips t when it is not installed.
func installedEffect(t *testing.T) string {
	t.Helper()
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../experiments/node_modules"
	}
	dir := filepath.Join(modules, "effect")
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err != nil {
		t.Skipf("effect is not installed: %v", err)
	}
	return dir
}

// barrelModules returns the modules that index, an index.d.ts of effect,
// lists: export * as Name from "./Name.ts".
func barrelModules(t *testing.T, index string) map[string]string {
	t.Helper()
	text, err := os.ReadFile(index)
	if err != nil {
		t.Fatal(err)
	}
	source := regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(string(text), "")
	modules := map[string]string{}
	for _, m := range regexp.MustCompile(`(?m)^export \* as (\w+) from "\./(\w+)\.ts";`).FindAllStringSubmatch(source, -1) {
		modules[m[1]] = m[2]
	}
	return modules
}

// subpathPackages returns every subpath package of the installed effect,
// such as effect/http, with the modules its index lists: each key of the
// package.json exports map other than the root, package.json, wildcards,
// and the paths it closes with null.
func subpathPackages(t *testing.T, effect string) map[string]map[string]string {
	t.Helper()
	text, err := os.ReadFile(filepath.Join(effect, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Exports map[string]any `json:"exports"`
	}
	if err := json.Unmarshal(text, &pkg); err != nil {
		t.Fatal(err)
	}
	packages := map[string]map[string]string{}
	for key, target := range pkg.Exports {
		if target == nil || key == "." || key == "./package.json" || strings.Contains(key, "*") {
			continue
		}
		subpath := strings.TrimPrefix(key, "./")
		packages["effect/"+subpath] = barrelModules(t, filepath.Join(effect, "dist", subpath, "index.d.ts"))
	}
	return packages
}

// TestEffectSubpathNamesMatchEffect checks effectSubpathNames and
// effectSubpathShared against the installed effect package (D310): every
// module a subpath package lists is in scope under its name, with the
// package and module it comes from, except a name that a root module takes
// (rule 2) and a name that two subpath packages list (rule 3).
func TestEffectSubpathNamesMatchEffect(t *testing.T) {
	effect := installedEffect(t)
	root := barrelModules(t, filepath.Join(effect, "dist", "index.d.ts"))
	listed := map[string][]effectSubpathExport{}
	for barrel, modules := range subpathPackages(t, effect) {
		for name, file := range modules {
			listed[name] = append(listed[name], effectSubpathExport{barrel: barrel, module: barrel + "/" + file})
		}
	}
	want := map[string]effectSubpathExport{}
	wantShared := map[string][]string{}
	for name, exports := range listed {
		if _, ok := root[name]; ok {
			for _, e := range exports {
				wantShared[name] = append(wantShared[name], e.barrel)
			}
			wantShared[name] = append(wantShared[name], "effect")
			slices.Sort(wantShared[name])
			continue
		}
		if len(exports) > 1 {
			for _, e := range exports {
				wantShared[name] = append(wantShared[name], e.barrel)
			}
			slices.Sort(wantShared[name])
			continue
		}
		want[name] = exports[0]
	}
	for name, export := range want {
		if got, ok := effectSubpathNames[name]; !ok || got != export {
			t.Errorf("effect's %s lists %s as %s; effectSubpathNames has %+v", export.barrel, name, export.module, got)
		}
	}
	for name := range effectSubpathNames {
		if _, ok := want[name]; !ok {
			t.Errorf("effectSubpathNames has %s, which no subpath package of effect lists alone", name)
		}
		if _, ok := effectRootNames[name]; ok {
			t.Errorf("effectSubpathNames has %s, a root module (rule 2)", name)
		}
	}
	if !sharedEqual(effectSubpathShared, wantShared) {
		t.Errorf("effectSubpathShared = %v; the subpath packages share %v", effectSubpathShared, wantShared)
	}
}

// TestDeclarationImportsSubpathModule checks that the declaration file of a
// .vibe file that names a subpath module in a type imports the module from
// its package, and that TypeScript, checking libraries, accepts it (D310).
func TestDeclarationImportsSubpathModule(t *testing.T) {
	t.Parallel()
	files := computedKeyFiles(false)
	effect := "/Users/x/src/node_modules/effect/"
	files[effect+"package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./process":{"types":"./process/index.d.ts"},"./*":{"types":"./*.d.ts"}}}`
	files[effect+"process/index.d.ts"] = `export * as ChildProcess from "./ChildProcess.js"`
	files[effect+"process/ChildProcess.d.ts"] = "export interface Command { readonly command: string }\nexport declare const make: (command: string) => Command"
	files["/Users/x/src/main.vibe"] = `export const command: ChildProcess.Command = ChildProcess.make("git")`
	dts := emitDeclarations(t, files)
	for _, want := range []string{`import { ChildProcess } from "effect/process";`, `export declare const command: ChildProcess.Command;`} {
		if !strings.Contains(dts, want) {
			t.Fatalf("declaration lacks %q:\n%s", want, dts)
		}
	}
	files["/Users/x/src/main.d.ts"] = dts
	delete(files, "/Users/x/src/main.vibe")
	files["/Users/x/src/consumer.ts"] = `import * as value from "./main.js"; export { value }`
	files["/Users/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"skipLibCheck":false,"module":"NodeNext","noEmit":true},"files":["consumer.ts"]}`
	for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("declaration consumer: %s\n%s", d.String(), dts)
		}
	}
}

// sharedEqual reports whether a and b hold the same names and packages.
func sharedEqual(a, b map[string][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for name, packages := range a {
		if !slices.Equal(packages, b[name]) {
			return false
		}
	}
	return true
}

// TestEffectNameCollisionsDocumented checks the table of effect module
// names that collide (D310) in the guide's page on Effect's modules: a
// name that a JavaScript or shared web global takes, that a root module
// takes, that two subpath packages share, or that only the DOM declares.
// The rows are computed from the installed package and TypeScript's lib
// files, so the page changes when Effect's exports do.
func TestEffectNameCollisionsDocumented(t *testing.T) {
	effect := installedEffect(t)
	root := barrelModules(t, filepath.Join(effect, "dist", "index.d.ts"))
	libValues := func(pattern string) (values, types map[string]bool) {
		values, types = map[string]bool{}, map[string]bool{}
		files, err := filepath.Glob(filepath.Join("..", "bundled", "libs", pattern))
		if err != nil || len(files) == 0 {
			t.Fatalf("no lib files %s: %v", pattern, err)
		}
		value := regexp.MustCompile(`(?m)^declare (?:var|const|let|function|class|namespace) (\w+)`)
		typ := regexp.MustCompile(`(?m)^(?:interface|type) (\w+)`)
		for _, file := range files {
			text, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range value.FindAllStringSubmatch(string(text), -1) {
				values[m[1]] = true
			}
			for _, m := range typ.FindAllStringSubmatch(string(text), -1) {
				types[m[1]] = true
			}
		}
		return values, types
	}
	es, _ := libValues("lib.es*.d.ts")
	domValues, domTypes := libValues("lib.dom.d.ts")
	listed := map[string][]string{}
	for barrel, modules := range subpathPackages(t, effect) {
		for name := range modules {
			listed[name] = append(listed[name], "`"+barrel+"`")
		}
	}
	var want []string
	for name, packages := range listed {
		slices.Sort(packages)
		var scope string
		switch _, isRoot := root[name]; {
		case es[name]:
			scope = "the JavaScript global (rule 1)"
		case isRoot:
			packages = append([]string{"`effect`"}, packages...)
			scope = "nothing: import the one you mean (rule 2)"
		case len(packages) > 1:
			scope = "nothing: import the one you mean (rule 3)"
		case domValues[name]:
			scope = "Effect's module; the DOM type keeps its name"
		case domTypes[name]:
			scope = "Effect's module; the DOM type keeps its name"
		default:
			continue
		}
		want = append(want, "| `"+name+"` | "+strings.Join(packages, ", ")+" | "+scope+" |")
	}
	slices.Sort(want)
	page, err := os.ReadFile("../../../../docs/user/src/getting-started/008-importing-effect.md")
	if err != nil {
		t.Fatal(err)
	}
	start, end := "<!-- D310 collisions: TestEffectNameCollisionsDocumented checks this table -->", "<!-- end D310 collisions -->"
	_, rest, ok := strings.Cut(string(page), start)
	table, _, ok2 := strings.Cut(rest, end)
	if !ok || !ok2 {
		t.Fatalf("the page lacks the collision table between %q and %q", start, end)
	}
	var got []string
	for _, line := range strings.Split(table, "\n") {
		if strings.HasPrefix(line, "| `") {
			got = append(got, line)
		}
	}
	if !slices.Equal(got, want) {
		t.Errorf("the page's collision table is\n%s\nthe installed effect gives\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
