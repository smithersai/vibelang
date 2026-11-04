package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const globalAugmentationQuote = "The compiler supplies intrinsic annotations for TypeScript's lib globals and the explicit wrapper thunks"
const globalAugmentationPlainQuote = "A call, \x60new\x60 expression, tagged template or class evaluation *known to throw* is \x60EK0401\x60, unless it sits in the \x60try\x60 block of a \x60try\x60 statement with a \x60catch\x60 clause in the same function."

var globalAugmentationForms = []string{"direct", "global", "alias", "global-alias"}
var globalAugmentationArities = []string{"legacy-reviver", "context-reviver"}
var globalAugmentationSites = []string{"plain", "caught", "bridge"}

func globalAugmentationNames() []string {
	var names []string
	for _, form := range globalAugmentationForms {
		for _, arity := range globalAugmentationArities {
			for _, site := range globalAugmentationSites {
				names = append(names, form+"/"+arity+"/"+site)
			}
		}
	}
	return names
}
func TestGlobalAugmentationQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", globalAugmentationQuote, globalAugmentationPlainQuote)
}
func TestGlobalAugmentationKeys(t *testing.T) {
	names := globalAugmentationNames()
	if len(names) != 24 {
		t.Fatalf("got %d keys, want 24", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatal(name)
		}
		seen[name] = true
		path := filepath.Join("testdata/fuzz/FuzzGlobalAugmentation", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong corpus key %s", path)
		}
	}
}
func FuzzGlobalAugmentation(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", globalAugmentationQuote, globalAugmentationPlainQuote)
	names := globalAugmentationNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		form := (i / 6) % 4
		arity := (i / 3) % 2
		site := i % 3
		value := "JSON.parse"
		if form == 1 || form == 3 {
			value = "globalThis." + value
		}
		prefix := ""
		if form >= 2 {
			prefix = "const parse=" + value + ";\n"
			value = "parse"
		}
		reviver := "(key:string,value:unknown)=>value"
		if arity == 1 {
			reviver = "(key:string,value:unknown,context:{source?:string})=>context.source ?? value"
		}
		call := value + "(text," + reviver + ")"
		bodies := []string{
			"export function check(text:string){return " + call + "}\n",
			"export function check(text:string){try{return " + call + "}catch{return null}}\n",
			"export effect function check(text:string){return try Effect.try(()=>" + call + ")}\n",
		}
		main := "import { Effect } from \"effect\"\n" + prefix + bodies[site]
		files := map[string]string{"main.vibe": main}
		config := strings.Replace(DefaultConfig, "\"target\": \"ES2022\",", "\"target\": \"ES2022\", \"lib\":[\"esnext\",\"dom\"],", 1)
		config = strings.TrimSuffix(config, "\n  }\n}") + ",\n    \"noEmit\":true\n  },\n  \"files\":[\"main.vibe\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := site == 0
		if len(errs) > 1 || (len(errs) == 1 && errs[0] != "EK0401") || (len(errs) == 1) != want {
			Gap(t, "FuzzGlobalAugmentation", "contract:"+names[i], "003-failures: %s; key %s got %v, want EK0401=%t\n%s", globalAugmentationPlainQuote, names[i], errs, want, Archive(files))
		}
	})
}
