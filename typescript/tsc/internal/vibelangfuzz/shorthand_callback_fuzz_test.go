package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var shorthandCallbackSources = []string{"never", "TypeError", "Error", "unknown"}
var shorthandCallbackBounds = []string{"never", "Error", "unknown"}

func shorthandCallbackNames() []string {
	var names []string
	for _, source := range shorthandCallbackSources {
		for _, bound := range shorthandCallbackBounds {
			for _, site := range []string{"argument", "initializer", "spread", "return"} {
				for _, binding := range []string{"direct", "renamed"} {
					names = append(names, fmt.Sprintf("%s/to-%s/%s/%s", source, bound, site, binding))
				}
			}
		}
	}
	return names
}
func TestForeignCallbackShorthandQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", assignabilityQuote)
}
func TestForeignCallbackShorthandKeys(t *testing.T) {
	names := shorthandCallbackNames()
	if len(names) != 96 {
		t.Fatalf("got %d keys, want96", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate %s", name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzForeignCallbackShorthand", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in %s", p)
		}
	}
}
func FuzzForeignCallbackShorthand(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", assignabilityQuote)
	names := shorthandCallbackNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		source := i / 24
		bound := (i / 8) % 3
		site := (i / 2) % 4
		renamed := i%2 == 1
		name, binding := "source", "source"
		if renamed {
			name, binding = "handler", "source as handler"
		}
		handlers := fmt.Sprintf("/** @throws {%s} */\nexport declare function source(): number\n"+
			"export interface Callback {\n /** @throws {%s} */\n (): number\n}\n"+
			"export interface Shape { %s: Callback }\n"+
			"/** @throws {never} */\nexport declare function take(value: Shape): void\n", shorthandCallbackSources[source], shorthandCallbackBounds[bound], name)
		body := "take({ " + name + " })"
		annotation := ""
		switch site {
		case 1:
			body = "const value: Shape = { " + name + " }; return value"
		case 2:
			body = "const value: Shape = { ...{ " + name + " } }; return value"
		case 3:
			body = "return { " + name + " }"
			annotation = ": Shape"
		}
		main := "import { " + binding + ", take, type Shape } from \"./handlers.js\"\nexport function check()" + annotation + " { " + body + " }\n"
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
			Gap(t, "FuzzForeignCallbackShorthand", "contract:"+names[i], "003-failures: %s; %s: got %v, want EK0402=%t\n%s", assignabilityQuote, names[i], errs, want, Archive(files))
		}
	})
}
