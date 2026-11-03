package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const callbackOverloadQuote = "Tags attach to call signatures: each overload and a returned callable's own signature carry their own."

var callbackOverloadBounds = []string{"never", "Error", "unknown"}
var callbackOverloadSources = [][2]int{{1, 0}, {0, 1}, {2, 0}, {0, 2}, {1, 2}, {2, 1}}

func callbackOverloadNames() []string {
	var names []string
	for _, source := range callbackOverloadSources {
		for parameter := 0; parameter < 2; parameter++ {
			for _, destination := range callbackOverloadBounds {
				for _, site := range []string{"direct", "alias"} {
					names = append(names, fmt.Sprintf("%s-%s/parameter-%d/%s/%s",
						callbackOverloadBounds[source[0]], callbackOverloadBounds[source[1]], parameter, destination, site))
				}
			}
		}
	}
	for source := range callbackOverloadBounds {
		for _, destination := range callbackOverloadSources {
			for _, site := range []string{"direct", "alias"} {
				names = append(names, fmt.Sprintf("single-%s/to-%s-%s/%s",
					callbackOverloadBounds[source], callbackOverloadBounds[destination[0]], callbackOverloadBounds[destination[1]], site))
			}
		}
	}
	for _, source := range callbackOverloadSources {
		for _, site := range []string{"direct", "alias"} {
			names = append(names, fmt.Sprintf("native-reject/%s-%s/%s",
				callbackOverloadBounds[source[0]], callbackOverloadBounds[source[1]], site))
		}
	}
	return names
}

func TestForeignCallbackOverloadsQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", callbackOverloadQuote, assignabilityQuote)
}

func TestForeignCallbackOverloadKeys(t *testing.T) {
	names := callbackOverloadNames()
	if len(names) != 120 {
		t.Fatalf("got %d keys, want 120", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate key %s", name)
		}
		seen[name] = true
		path := filepath.Join("testdata/fuzz/FuzzForeignCallbackOverloads", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in %s", path)
		}
	}
}

func FuzzForeignCallbackOverloads(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", callbackOverloadQuote, assignabilityQuote)
	names := callbackOverloadNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		var handlers string
		var want bool
		nativeReject := i >= 108
		if nativeReject {
			source := callbackOverloadSources[(i-108)/2]
			handlers = fmt.Sprintf("/** @throws {%s} */\nexport declare function source(value: 0): number\n"+
				"/** @throws {%s} */\nexport declare function source(value: 1): number\n"+
				"export interface Handler { (value: 2): number }\n",
				callbackOverloadBounds[source[0]], callbackOverloadBounds[source[1]])
		} else if i < 72 {
			source := callbackOverloadSources[i/12]
			parameter := (i / 6) % 2
			destination := (i / 2) % 3
			handlers = fmt.Sprintf("/** @throws {%s} */\nexport declare function source(value: 0): number\n"+
				"/** @throws {%s} */\nexport declare function source(value: 1): number\n"+
				"export interface Handler {\n /** @throws {%s} */\n (value: %d): number\n}\n",
				callbackOverloadBounds[source[0]], callbackOverloadBounds[source[1]], callbackOverloadBounds[destination], parameter)
			want = source[parameter] > destination
		} else {
			j := i - 72
			source := j / 12
			destination := callbackOverloadSources[(j/2)%6]
			handlers = fmt.Sprintf("/** @throws {%s} */\nexport declare function source(value: 0 | 1): number\n"+
				"export interface Handler {\n /** @throws {%s} */\n (value: 0): number\n"+
				" /** @throws {%s} */\n (value: 1): number\n}\n",
				callbackOverloadBounds[source], callbackOverloadBounds[destination[0]], callbackOverloadBounds[destination[1]])
			want = source > destination[0] || source > destination[1]
		}
		handlers += "/** @throws {never} */\nexport declare function call(f: Handler): void\n"
		alias := i%2 != 0
		binding, value := "", "source"
		if alias {
			binding, value = "const value = source\n", "value"
		}
		main := "import { source, call } from \"./handlers.js\"\n" + binding + "export function check() { call(" + value + ") }\n"
		files := map[string]string{"main.vibe": main, "handlers.d.ts": handlers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		got, native := false, false
		for _, code := range errs {
			if code == "EK0402" {
				got = true
			} else if nativeReject && code == "TS2345" {
				native = true
			} else {
				t.Fatalf("%s: unexpected %v\n%s", names[i], errs, Archive(files))
			}
		}
		if nativeReject {
			if got || !native || len(errs) != 1 {
				Gap(t, "FuzzForeignCallbackOverloads", "native-relation:"+names[i],
					"003-failures: %s; TypeScript rejects parameter 2: want only TS2345, got %v\n%s",
					assignabilityQuote, errs, Archive(files))
			}
			return
		}
		if got != want {
			Gap(t, "FuzzForeignCallbackOverloads", "contract:"+names[i],
				"003-failures: %s; %s: got %v, want EK0402=%t\n%s", callbackOverloadQuote, names[i], errs, want, Archive(files))
		}
	})
}
