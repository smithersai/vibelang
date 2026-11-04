package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// VIP-4 puts the contract on the callable: indexing a foreign object does
// not erase it. The same source/destination contracts exercise arguments
// and object members with string, const, numeric and unique-symbol keys.
var callbackElementKeys = []struct{ name, expression string }{
	{"string", `handlers["source"]`},
	{"const", "handlers[key]"},
	{"number", "handlers[0]"},
	{"symbol", "handlers[token]"},
}

func callbackElementNames() []string {
	var names []string
	for _, key := range callbackElementKeys {
		for _, src := range callbackImplementationSources {
			for _, dst := range callbackDestinations {
				for _, site := range []string{"argument", "member"} {
					names = append(names, key.name+"/"+src.name+"/"+dst.name+"/"+site)
				}
			}
		}
	}
	return names
}

func TestForeignCallbackElementValuesQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", assignabilityQuote, untaggedQuote)
}

func TestForeignCallbackElementValueKeys(t *testing.T) {
	names := callbackElementNames()
	if len(names) != 96 {
		t.Fatalf("got %d keys, want 96", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate key %s", name)
		}
		seen[name] = true
		path := filepath.Join("testdata/fuzz/FuzzForeignCallbackElementValues", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong corpus key in %s", path)
		}
	}
}

func FuzzForeignCallbackElementValues(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", assignabilityQuote, untaggedQuote)
	names := callbackElementNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		site := i % 2
		dst := callbackDestinations[(i/2)%len(callbackDestinations)]
		src := callbackImplementationSources[(i/(2*len(callbackDestinations)))%len(callbackImplementationSources)]
		key := callbackElementKeys[i/(2*len(callbackDestinations)*len(callbackImplementationSources))]
		handlers := "export const token: unique symbol = Symbol(\"callback\")\nexport const handlers = {\n" +
			src.tag + "\n source(): void {},\n" + src.tag + "\n 0(): void {},\n" + src.tag + "\n [token](): void {}\n}\n" + dst.decl + "\n" +
			"/** @throws {never} */\nexport declare function call(f: Handler): void\n" +
			"/** @throws {never} */\nexport declare function take(value: { onCall: Handler }): void\n"
		use := "call(" + key.expression + ")"
		if site == 1 {
			use = "take({ onCall: " + key.expression + " })"
		}
		main := "import { handlers, token, call, take } from \"./handlers.ts\"\nconst key = \"source\" as const\nexport function check() { " + use + " }\n"
		files := map[string]string{"main.vibe": main, "handlers.ts": handlers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"allowImportingTsExtensions\": true,\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := src.thrown > dst.admits
		got := slices.Contains(errs, "EK0402")
		for _, code := range errs {
			if code != "EK0402" {
				t.Fatalf("%s: unexpected %v\n%s", names[i], errs, Archive(files))
			}
		}
		if got != want {
			Gap(t, "FuzzForeignCallbackElementValues", "contract:"+names[i], "003-failures: %s; %s: got %v, want EK0402=%t\n%s", assignabilityQuote, names[i], errs, want, Archive(files))
		}
	})
}
