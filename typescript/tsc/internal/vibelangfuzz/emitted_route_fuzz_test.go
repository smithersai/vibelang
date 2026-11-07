package vibelangfuzz

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

// Chapter 007, Output names: compiled output names a routed module by its
// own output, so no #vibelang/emitted/ route reaches JavaScript or
// declarations.
const (
	emittedRouteOutputQuote  = "JavaScript and ordinary declaration output name that source by its own relative output, `./user.js`, as for a relative import"
	emittedRoutePublishQuote = "So a route never reaches published code, and the program loads one copy of the module."
)

var (
	emittedRouteImporters = []string{"ts", "vibe"}
	emittedRouteSites     = []string{"import", "export-star", "export-named", "dynamic", "type"}
	emittedRouteTargets   = []string{"vibe", "ts"}
	emittedRouteLayouts   = []string{"flat", "nested", "up"}
	emittedRouteForms     = []string{"exact", "star"}
)

type emittedRouteVariant struct {
	importer, site, target, layout, form string
}

func (v emittedRouteVariant) name() string {
	return strings.Join([]string{v.importer, v.site, v.target, v.layout, v.form}, "/")
}

func emittedRouteVariants() ([]emittedRouteVariant, []string) {
	var variants []emittedRouteVariant
	for _, importer := range emittedRouteImporters {
		for _, site := range emittedRouteSites {
			// A .vibe module's own runtime imports are static; import() and
			// import types stay in TypeScript files here.
			if importer == "vibe" && (site == "dynamic" || site == "type") {
				continue
			}
			for _, target := range emittedRouteTargets {
				for _, layout := range emittedRouteLayouts {
					for _, form := range emittedRouteForms {
						variants = append(variants, emittedRouteVariant{importer: importer, site: site, target: target, layout: layout, form: form})
					}
				}
			}
		}
	}
	names := make([]string, len(variants))
	for i, v := range variants {
		names[i] = v.name()
	}
	return variants, names
}

// project returns the files of v, the importer's name and the specifier its
// output must use for the routed module.
func (v emittedRouteVariant) project() (map[string]string, string, string) {
	target := "user." + v.target
	importer := "main." + v.importer
	switch v.layout {
	case "nested":
		target = "lib/" + target
	case "up":
		importer = "sub/" + importer
	}
	stem := strings.TrimSuffix(target, "."+v.target)
	route, key, source := "#vibelang/emitted/"+stem, "#vibelang/emitted/"+stem, "./"+target
	if v.form == "star" {
		key, source = "#vibelang/emitted/*", "./*."+v.target
	}
	condition := fmt.Sprintf(`"vibelang-source":%q,`, source)
	manifest := fmt.Sprintf(`{"type":"module","imports":{%q:{%s"types":"./%s","default":"./elsewhere/%s.js"}}}`, key, condition, target, stem)
	var body string
	switch v.site {
	case "import":
		body = fmt.Sprintf("import { value } from %q\nexport const twice: number = value + value\n", route)
	case "export-star":
		body = fmt.Sprintf("export * from %q\n", route)
	case "export-named":
		body = fmt.Sprintf("export { value } from %q\n", route)
	case "dynamic":
		body = fmt.Sprintf("export const load = () => import(%q)\n", route)
	case "type":
		body = fmt.Sprintf("export type User = typeof import(%q)\n", route)
	}
	expected, _ := filepath.Rel(path.Dir(importer), target)
	expected = "./" + strings.TrimSuffix(filepath.ToSlash(expected), "."+v.target) + ".js"
	if strings.HasPrefix(expected, "./../") {
		expected = strings.TrimPrefix(expected, "./")
	}
	files := map[string]string{"package.json": manifest, target: "export const value: number = 1\n", importer: body}
	return files, importer, expected
}

func TestEmittedRoutesQuoted(t *testing.T) {
	r4Quoted(t, "007-tooling.md", emittedRouteOutputQuote, emittedRoutePublishQuote)
}

func TestEmittedRouteKeys(t *testing.T) {
	_, names := emittedRouteVariants()
	if len(names) != 96 {
		t.Fatalf("got %d keys, want 96", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzEmittedRoutes", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key %s", p)
		}
	}
}

func FuzzEmittedRoutes(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "007-tooling.md", emittedRouteOutputQuote, emittedRoutePublishQuote)
	variants, names := emittedRouteVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		files, importer, expected := v.project()
		var sources []string
		for name := range files {
			if name != "package.json" {
				sources = append(sources, fmt.Sprintf("%q", name))
			}
		}
		config := strings.Replace(DefaultConfig, "\"target\": \"ES2022\",", "\"target\": \"ES2022\", \"customConditions\": [\"vibelang-source\"],", 1)
		config = strings.TrimSuffix(config, "\n}") + ",\n  \"files\": [" + strings.Join(sources, ",") + "]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		if len(errs) != 0 {
			Gap(t, "FuzzEmittedRoutes", "route:"+v.name(), "007-tooling: %s; key %s got errors %v\n%s", emittedRouteOutputQuote, v.name(), errs, Archive(files))
			return
		}
		stem := "out/" + strings.TrimSuffix(importer, path.Ext(importer))
		for name, text := range r.Outputs {
			if strings.Contains(text, "#vibelang/emitted/") {
				Gap(t, "FuzzEmittedRoutes", "route:"+v.name(), "007-tooling: %s; key %s: %s keeps the route\n%s\n%s", emittedRoutePublishQuote, v.name(), name, text, Archive(files))
			}
		}
		quoted := fmt.Sprintf("%q", expected)
		js, dts := r.Outputs[stem+".js"], r.Outputs[stem+".d.ts"]
		if v.site != "type" && !strings.Contains(js, quoted) {
			Gap(t, "FuzzEmittedRoutes", "route:"+v.name(), "007-tooling: %s; key %s: JavaScript does not name %s\n%s\n%s", emittedRouteOutputQuote, v.name(), quoted, js, Archive(files))
		}
		if v.site != "import" && !strings.Contains(dts, quoted) {
			Gap(t, "FuzzEmittedRoutes", "route:"+v.name(), "007-tooling: %s; key %s: declarations do not name %s\n%s\n%s", emittedRouteOutputQuote, v.name(), quoted, dts, Archive(files))
		}
	})
}
