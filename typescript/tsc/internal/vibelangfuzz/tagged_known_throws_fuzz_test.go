package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const taggedKnownQuote = "A call, \x60new\x60 expression, tagged template or class evaluation *known to throw* is \x60EK0401\x60, unless it sits in the \x60try\x60 block of a \x60try\x60 statement with a \x60catch\x60 clause in the same function."

var taggedKnownThrows = []string{"never", "Error", "unknown"}
var taggedKnownSites = []string{"plain", "caught", "bridge"}

func taggedKnownNames() []string {
	var names []string
	for _, thrown := range taggedKnownThrows {
		for _, site := range taggedKnownSites {
			for _, form := range []string{"name", "namespace"} {
				names = append(names, thrown+"/"+site+"/"+form)
			}
		}
	}
	return names
}
func TestTaggedKnownThrowsQuoted(t *testing.T) { r4Quoted(t, "003-failures.md", taggedKnownQuote) }
func TestTaggedKnownThrowsKeys(t *testing.T) {
	names := taggedKnownNames()
	if len(names) != 18 {
		t.Fatalf("got %d keys, want 18", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzTaggedKnownThrows", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key %s", p)
		}
	}
}
func FuzzTaggedKnownThrows(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", taggedKnownQuote)
	names := taggedKnownNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		thrown := (i / 6) % 3
		site := (i / 2) % 3
		helpers := fmt.Sprintf("/** @throws {%s} */\nexport declare function tag(parts:TemplateStringsArray):unknown\n", taggedKnownThrows[thrown])
		imported, tag := "import {tag} from \"./helpers.js\"\n", "tag"
		if i%2 == 1 {
			imported, tag = "import * as Tags from \"./helpers.js\"\n", "Tags.tag"
		}
		invoke := tag + "\x60x\x60"
		bodies := []string{"export function check(){return " + invoke + "}\n", "export function check(){try{return " + invoke + "}catch{return null}}\n", "export effect function check(){return try Effect.try(()=>" + invoke + ")}\n"}
		main := "import {Effect} from \"effect\"\n" + imported + bodies[site]
		files := map[string]string{"main.vibe": main, "helpers.d.ts": helpers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\",\"helpers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := thrown != 0 && site == 0
		if len(errs) > 1 || len(errs) == 1 && errs[0] != "EK0401" || (len(errs) == 1) != want {
			Gap(t, "FuzzTaggedKnownThrows", "contract:"+names[i], "003-failures: %s; key %s got %v, want EK0401=%t\n%s", taggedKnownQuote, names[i], errs, want, Archive(files))
		}
	})
}
