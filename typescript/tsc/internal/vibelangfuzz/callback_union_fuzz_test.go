package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const callbackUnionQuote = "callable unions combine their alternatives."

var callbackUnionBounds = []string{"never", "Error", "unknown"}
var callbackUnionPairs = [][2]int{{0, 0}, {0, 1}, {0, 2}, {1, 0}, {1, 1}, {1, 2}, {2, 0}, {2, 1}, {2, 2}}
var callbackUnionNativePairs = [][2]int{{0, 1}, {1, 0}, {0, 2}, {2, 0}, {1, 2}, {2, 1}}

func callbackUnionNames() []string {
	var names []string
	for _, pair := range callbackUnionPairs {
		for _, bound := range callbackUnionBounds {
			for _, kind := range []string{"foreign", "alias"} {
				for _, site := range []string{"argument", "initializer"} {
					names = append(names, fmt.Sprintf("%s-%s/to-%s/%s/%s", callbackUnionBounds[pair[0]], callbackUnionBounds[pair[1]], bound, kind, site))
				}
			}
		}
	}
	for _, pair := range callbackUnionNativePairs {
		for _, kind := range []string{"foreign", "alias"} {
			names = append(names, fmt.Sprintf("native/%s-%s/%s", callbackUnionBounds[pair[0]], callbackUnionBounds[pair[1]], kind))
		}
	}
	return names
}

func TestForeignCallbackUnionsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", callbackUnionQuote, assignabilityQuote)
}
func TestForeignCallbackUnionKeys(t *testing.T) {
	names := callbackUnionNames()
	if len(names) != 120 {
		t.Fatalf("got %d keys, want 120", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate %s", name)
		}
		seen[name] = true
		path := filepath.Join("testdata/fuzz/FuzzForeignCallbackUnions", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in %s", path)
		}
	}
}
func FuzzForeignCallbackUnions(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", callbackUnionQuote, assignabilityQuote)
	names := callbackUnionNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		native := i >= 108
		var pair [2]int
		bound, kind, site := 0, 0, 0
		leftParameter, rightParameter, targetParameter := "", "", ""
		if native {
			pair = callbackUnionNativePairs[(i-108)/2]
			kind = i % 2
			leftParameter, rightParameter, targetParameter = "value: 0", "value: 1", "value: 2"
		} else {
			pair = callbackUnionPairs[i/12]
			bound = (i / 4) % 3
			kind = (i / 2) % 2
			site = i % 2
		}
		handlers := fmt.Sprintf("/** @throws {%s} */\nexport declare function left(%s): 0\n"+
			"/** @throws {%s} */\nexport declare function right(%s): 1\n"+
			"export declare const foreign: typeof left | typeof right\n"+
			"export interface Handler {\n /** @throws {%s} */\n (%s): 0 | 1\n}\n"+
			"/** @throws {never} */\nexport declare function take(f: Handler): void\n",
			callbackUnionBounds[pair[0]], leftParameter, callbackUnionBounds[pair[1]], rightParameter, callbackUnionBounds[bound], targetParameter)
		binding, value := "", "foreign"
		if kind == 1 {
			binding, value = "const saved = flag ? left : right\n", "saved"
		}
		body := "take(" + value + ")"
		if site == 1 {
			body = "const target: Handler = " + value
		}
		main := "import { left, right, foreign, take, type Handler } from \"./handlers.js\"\n" +
			"export function check(flag: boolean) {\n" + binding + body + "\n}\n"
		files := map[string]string{"main.vibe": main, "handlers.d.ts": handlers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		if native {
			if len(errs) != 1 || errs[0] != "TS2345" {
				Gap(t, "FuzzForeignCallbackUnions", "native:"+names[i], "003-failures: %s; want only native TS2345, got %v\n%s", assignabilityQuote, errs, Archive(files))
			}
			return
		}
		want := pair[0] > bound || pair[1] > bound
		got := false
		for _, code := range errs {
			if code != "EK0402" {
				t.Fatalf("%s: unexpected %v\n%s", names[i], errs, Archive(files))
			}
			got = true
		}
		if got != want || len(errs) > 1 {
			Gap(t, "FuzzForeignCallbackUnions", "contract:"+names[i], "003-failures: %s; %s: got %v, want EK0402=%t\n%s", callbackUnionQuote, names[i], errs, want, Archive(files))
		}
	})
}
