package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

const foreignCallbackCallsQuote = "An effectful callable's thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel."

func TestMigrationForeignCallbackCallsQuoted(t *testing.T) {
	for _, quote := range []struct{ chapter, text string }{
		{"003-failures.md", foreignCallbackCallsQuote},
		{"003-failures.md", "| no tag | `unknown` |"},
		{"003-failures.md", "Tags attach to call signatures: each overload and a returned callable's own signature carry their own."},
	} {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

func foreignCallbackCallFiles(carrier, callee string, mode int) map[string]string {
	prefix := "import * as Effect from \"effect/Effect\";\n"
	if mode&1 != 0 {
		prefix += "import { die } from \"effect/Effect\";\n"
	}
	if mode&16 != 0 {
		prefix = strings.TrimPrefix(prefix, "import * as Effect from \"effect/Effect\";\n")
	}
	imported, call := "import { foreign } from \"./foreign.js\";\n", "foreign"
	switch callee {
	case "alias":
		imported, call = "import { foreign as invoke } from \"./foreign.js\";\n", "invoke"
	case "namespace":
		imported, call = "import * as native from \"./foreign.js\";\n", "native.foreign"
	case "method":
		imported, call = "import { native } from \"./foreign.js\";\n", "native.foreign"
	}
	annotation := ""
	if mode&8 != 0 {
		annotation = "/** @throws {never} */ "
	}
	foreign := annotation + "export declare function foreign(error: unknown): { readonly errorType: \"object\" };\n"
	if callee == "method" {
		foreign = "export declare const native: {\n" + annotation + "foreign(error: unknown): { readonly errorType: \"object\" };\n};\n"
	}
	body := call + "(\"failure\"); return Effect.void;"
	if mode&2 != 0 {
		body = "/* retain call */ " + body
	}
	callback := "() => { " + body + " }"
	if mode&32 != 0 {
		callback = "function () { " + body + " }"
	}
	expression := "Effect.suspend(" + callback + ")"
	if carrier == "catch" {
		expression = "Effect.fail(1).pipe(Effect.catch(" + callback + "))"
	}
	source := prefix + imported + "export const program = " + expression + ";\n"
	if mode&4 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
		foreign = strings.ReplaceAll(foreign, "\n", "\r\n")
	}
	return map[string]string{"main.vibe": source, "foreign.d.ts": foreign}
}

// These originals must also be accepted by the unmodified TypeScript compiler;
// a skipped baseline cannot qualify a minimized source or its typed controls.
func TestMigrationForeignCallbackCallsStockTwins(t *testing.T) {
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	for _, tc := range []struct {
		carrier, callee string
		mode            int
	}{
		{"suspend", "direct", 0},
		{"catch", "namespace", 1},
		{"suspend", "method", 8},
		{"catch", "alias", 57},
	} {
		var child *testing.T
		t.Run(fmt.Sprintf("%s-%s-%d", tc.carrier, tc.callee, tc.mode), func(t *testing.T) {
			child = t
			files := foreignCallbackCallFiles(tc.carrier, tc.callee, tc.mode)
			files["main.ts"] = files["main.vibe"]
			delete(files, "main.vibe")
			if tc.mode&16 != 0 {
				files["main.ts"] = "import * as Effect from \"effect/Effect\";\n" + files["main.ts"]
			}
			dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: files, Config: DefaultConfig})
			defer os.RemoveAll(dir)
		})
		if child.Skipped() {
			t.Fatal("stock TypeScript rejected an intended original")
		}
	}
}
