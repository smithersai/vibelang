package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const callbackAliasQuote = "\x60const g = f\x60 preserves \x60f\x60's contract"

var callbackAliasShapes = []struct{ name, code string }{
	{"const", "const value = source"},
	{"chain", "const first = source; const value = first"},
	{"object", "const { source: value } = { source }"},
	{"array", "const [value] = [source] as const"},
	{"bind", "const value = source.bind(undefined)"},
	{"annotated", "const value: typeof source = source"},
	{"native", "const value = nativeAlias"},
	{"returned", "const value = (() => source)()"},
}

func callbackAliasNames() []string {
	var names []string
	for shape, alias := range callbackAliasShapes {
		for s, src := range callbackSources {
			for d, dst := range callbackDestinations {
				site := "argument"
				if (shape+s+d)%2 != 0 {
					site = "member"
				}
				names = append(names, alias.name+"/"+src.name+"/"+dst.name+"/"+site)
			}
		}
	}
	return names
}

func TestForeignCallbackAliasesQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", callbackAliasQuote, assignabilityQuote, untaggedQuote)
}

func TestForeignCallbackAliasKeys(t *testing.T) {
	names := callbackAliasNames()
	if len(names) != 96 {
		t.Fatalf("got %d alias keys, want 96", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate alias key %s", name)
		}
		seen[name] = true
		path := filepath.Join("testdata/fuzz/FuzzForeignCallbackAliases", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in %s", path)
		}
	}
}

func FuzzForeignCallbackAliases(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", callbackAliasQuote, assignabilityQuote, untaggedQuote)
	names := callbackAliasNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		shape := i / (len(callbackSources) * len(callbackDestinations))
		s := (i / len(callbackDestinations)) % len(callbackSources)
		d := i % len(callbackDestinations)
		alias, src, dst := callbackAliasShapes[shape], callbackSources[s], callbackDestinations[d]
		handlers := src.tag + "\nexport function source(): void {}\nexport const nativeAlias = source\n" + dst.decl + "\n" +
			"/** @throws {never} */\nexport declare function call(f: Handler): void\n" +
			"/** @throws {never} */\nexport declare function take(value: { onCall: Handler }): void\n"
		use := "call(value)"
		if (shape+s+d)%2 != 0 {
			use = "take({ onCall: value })"
		}
		main := "import { source, nativeAlias, call, take } from \"./handlers.ts\"\n" + alias.code + "\nexport function check() { " + use + " }\n"
		files := map[string]string{"main.vibe": main, "handlers.ts": handlers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"allowImportingTsExtensions\": true,\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := src.thrown > dst.admits
		got := false
		for _, code := range errs {
			if code == "EK0402" {
				got = true
			} else {
				t.Fatalf("%s: unexpected %v\n%s", names[i], errs, Archive(files))
			}
		}
		if got != want {
			Gap(t, "FuzzForeignCallbackAliases", "contract:"+names[i], "003-failures: %s; %s: got %v, want EK0402=%t\n%s", callbackAliasQuote, names[i], errs, want, Archive(files))
		}
	})
}
