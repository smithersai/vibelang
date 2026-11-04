package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const foreignPromiseQuote = "A foreign Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain."

var foreignPromiseBounds = []string{"never", "Error", "unknown", "untagged"}
var foreignPromiseReturns = []string{"Promise", "PromiseLike"}
var foreignPromiseSites = []string{"function", "default", "field"}
var foreignPromiseBoundaries = []string{"plain", "caught", "Effect.try"}

type foreignPromiseVariant struct{ bound, result, site, boundary int }

func (v foreignPromiseVariant) name() string {
	return fmt.Sprintf("%s/%s/%s/%s", foreignPromiseBounds[v.bound], foreignPromiseReturns[v.result], foreignPromiseSites[v.site], foreignPromiseBoundaries[v.boundary])
}
func foreignPromiseVariants() ([]foreignPromiseVariant, []string) {
	var variants []foreignPromiseVariant
	var names []string
	for bound := range foreignPromiseBounds {
		for result := range foreignPromiseReturns {
			for site := range foreignPromiseSites {
				for boundary := range foreignPromiseBoundaries {
					v := foreignPromiseVariant{bound, result, site, boundary}
					variants = append(variants, v)
					names = append(names, v.name())
				}
			}
		}
	}
	return variants, names
}
func TestForeignPromiseThrowsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", foreignPromiseQuote)
}
func TestForeignPromiseThrowsKeys(t *testing.T) {
	_, names := foreignPromiseVariants()
	if len(names) != 72 {
		t.Fatalf("got%d keys", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzForeignPromiseThrows", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatal(p)
		}
	}
}
func FuzzForeignPromiseThrows(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", foreignPromiseQuote)
	variants, names := foreignPromiseVariants()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		v := variants[r4Pick(data, names)]
		helpers := "export declare function source():" + foreignPromiseReturns[v.result] + "<number>\n"
		if v.bound != 3 {
			helpers = "/** @throws {" + foreignPromiseBounds[v.bound] + "} */\n" + helpers
		}
		expression := "source()"
		if v.boundary == 1 {
			expression = "(() => {try{return source()}catch{return undefined}})()"
		}
		if v.boundary == 2 {
			expression = "Effect.try(() => source())"
		}
		declaration := "export function probe(){return " + expression + "}\n"
		if v.site == 1 {
			declaration = "export function probe(value=" + expression + "){return value}\n"
		}
		if v.site == 2 {
			declaration = "export class Box {value=" + expression + "}\n"
		}
		main := "import {source} from \"./helpers.js\"\nimport * as Effect from \"effect/Effect\"\n" + declaration
		files := map[string]string{"main.vibe": main, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := r4Errors(r.Diagnostics)
		want := v.boundary == 0 && (v.bound == 1 || v.bound == 2)
		if len(errors) > 1 || len(errors) == 1 && errors[0] != "EK0401" || (len(errors) == 1) != want {
			Gap(t, "FuzzForeignPromiseThrows", "contract:"+v.name(), "003-failures: %s; key %s got%v want EK0401=%t\n%s", foreignPromiseQuote, v.name(), errors, want, Archive(files))
		}
	})
}
