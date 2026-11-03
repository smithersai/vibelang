package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const callbackAliasTagQuote = "a tag on an alias of a function type does not attach"

var callbackAliasTagSources = []string{"never", "TypeError", "Error", "unknown"}
var callbackAliasTagBounds = []string{"never", "Error", "unknown"}

func callbackAliasTagNames() []string {
	var names []string
	for _, source := range callbackAliasTagSources {
		for _, tag := range callbackAliasTagBounds {
			for _, shape := range []string{"function", "parenthesized", "call-never", "call-Error", "call-unknown"} {
				for _, site := range []string{"argument", "initializer"} {
					names = append(names, fmt.Sprintf("%s/alias-%s/%s/%s", source, tag, shape, site))
				}
			}
		}
	}
	return names
}

func TestForeignCallbackAliasTagsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", callbackAliasTagQuote, assignabilityQuote)
}

func TestForeignCallbackAliasTagKeys(t *testing.T) {
	names := callbackAliasTagNames()
	if len(names) != 120 {
		t.Fatalf("got %d keys, want 120", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate key %s", name)
		}
		seen[name] = true
		path := filepath.Join("testdata/fuzz/FuzzForeignCallbackAliasTags", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in %s", path)
		}
	}
}

func FuzzForeignCallbackAliasTags(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", callbackAliasTagQuote, assignabilityQuote)
	names := callbackAliasTagNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		source := i / 30
		tag := (i / 10) % 3
		shape := (i / 2) % 5
		bound := 0
		functionType := "() => number"
		if shape == 1 {
			functionType = "(() => number)"
		}
		if shape >= 2 {
			bound = shape - 2
			functionType = fmt.Sprintf("{\n /** @throws {%s} */\n (): number\n}", callbackAliasTagBounds[bound])
		}
		handlers := fmt.Sprintf("/** @throws {%s} */\nexport declare function source(): number\n/** @throws {%s} */\nexport type Handler = %s\n/** @throws {never} */\nexport declare function call(f: Handler): void\n", callbackAliasTagSources[source], callbackAliasTagBounds[tag], functionType)
		main := "import { source, call, type Handler } from \"./handlers.js\"\n"
		if i%2 == 0 {
			main += "export function check() { call(source) }\n"
		} else {
			main += "export const saved: Handler = source\n"
		}
		files := map[string]string{"main.vibe": main, "handlers.d.ts": handlers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		sourceBound := source
		if source == 1 || source == 2 {
			sourceBound = 1
		}
		if source == 3 {
			sourceBound = 2
		}
		want := sourceBound > bound
		got := false
		for _, code := range errs {
			if code != "EK0402" {
				t.Fatalf("%s: unexpected %v\n%s", names[i], errs, Archive(files))
			}
			got = true
		}
		if got != want || len(errs) > 1 {
			Gap(t, "FuzzForeignCallbackAliasTags", "contract:"+names[i], "003-failures: %s; %s: got %v, want EK0402=%t\n%s", callbackAliasTagQuote, names[i], errs, want, Archive(files))
		}
	})
}
