package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const constructorCallbackQuote = "A callable whose thrown type is \x60T\x60 is assignable to a function type only when that type admits \x60T\x60"
const constructorDeclarationQuote = "each call, construct or method signature of an exported \x60interface\x60, type literal or \x60type\x60 alias carry \x60@throws {never}\x60."

var constructorCallbackSources = []string{"never", "TypeError", "Error", "unknown"}
var constructorCallbackBounds = []string{"never", "Error", "unknown"}
var constructorCallbackKinds = []string{"class", "signature"}
var constructorCallbackSites = []string{"argument", "initializer", "object", "return"}

func constructorCallbackNames() []string {
	var names []string
	for _, s := range constructorCallbackSources {
		for _, b := range constructorCallbackBounds {
			for _, k := range constructorCallbackKinds {
				for _, site := range constructorCallbackSites {
					names = append(names, s+"/to-"+b+"/"+k+"/"+site)
				}
			}
		}
	}
	return names
}
func TestConstructorCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", constructorCallbackQuote)
	r4Quoted(t, "001-functions.md", constructorDeclarationQuote)
}
func TestConstructorCallbackKeys(t *testing.T) {
	names := constructorCallbackNames()
	if len(names) != 96 {
		t.Fatalf("got%d keys,want96", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzConstructorCallbacks", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key%s", p)
		}
	}
}
func FuzzConstructorCallbacks(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", constructorCallbackQuote)
	r4Quoted(f, "001-functions.md", constructorDeclarationQuote)
	names := constructorCallbackNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		src := (i / 24) % 4
		bound := (i / 8) % 3
		kind := (i / 4) % 2
		site := i % 4
		source := fmt.Sprintf("export declare class Source {\n readonly value:number\n /** @throws {%s} */\n constructor(value:number)\n}\n", constructorCallbackSources[src])
		if kind == 1 {
			source = fmt.Sprintf("export interface Constructor {\n /** @throws {%s} */\n new(value:number): Item\n}\nexport declare const Source: Constructor\n", constructorCallbackSources[src])
		}
		helpers := "export interface Item {readonly value:number}\n" + source + fmt.Sprintf("export interface Handler {\n /** @throws {%s} */\n new(value:number):Item\n}\n/** @throws {never} */\nexport declare function take(value:Handler):void\n", constructorCallbackBounds[bound])
		bodies := []string{"export function check(){take(Source)}", "export function check(){const saved:Handler=Source;return saved}", "export function check(){const saved:{ctor:Handler}={ctor:Source};return saved}", "export function check():Handler{return Source}"}
		main := "import { Source, take, type Handler } from \"./helpers.js\"\n" + bodies[site] + "\n"
		files := map[string]string{"main.vibe": main, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := src != 0 && (bound == 0 || src == 3 && bound == 1)
		got := false
		for _, code := range errs {
			if code != "EK0402" {
				t.Fatalf("%s unexpected%v\n%s", names[i], errs, Archive(files))
			}
			got = true
		}
		if got != want || len(errs) > 1 {
			Gap(t, "FuzzConstructorCallbacks", "contract:"+names[i], "003-failures: %s: got%v,want EK0402=%t\n%s", names[i], errs, want, Archive(files))
		}
	})
}
