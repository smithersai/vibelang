package compiler

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// These are printed TypeScript string literals, not raw filesystem paths.
// All declaration module-reference forms must resolve the decoded value,
// retaining their quote delimiter and escaping it when writing a new path.
func TestSidecarTextEscapedSpecifiers(t *testing.T) {
	t.Parallel()
	spellings := []struct{ literal, stem, want string }{
		{"\"./plain.js\"", "plain", "\"./plain.vibe\""},
		{"'./plain.js'", "plain", "'./plain.vibe'"},
		{"\"./odd'name.js\"", "odd'name", "\"./odd'name.vibe\""},
		{"'./odd\"name.js'", "odd\"name", "'./odd\"name.vibe'"},
		{"\"./odd\\\"name.js\"", "odd\"name", "\"./odd\\\"name.vibe\""},
		{"'./odd\\'name.js'", "odd'name", "'./odd\\'name.vibe'"},
		{"\"./caf\\u00E9.js\"", "café", ""},
		{"'./caf\\xE9.js'", "café", ""},
		{"\"./\\u{661f}.js\"", "星", ""},
		{"'./face\\uD83D\\uDE00.js'", "face😀", ""},
		{"\"\\u002e\\u002fplain.js\"", "plain", ""},
		{"'./pl\\\nain.js'", "plain", ""},
		{"\"../odd'name.js\"", "../odd'name", "\"../odd'name.vibe\""},
	}
	forms := []string{
		"import { Value } from %s;",
		"import %s;",
		"export { Value } from %s;",
		"export * from %s;",
		"export type Value = import(%s).Value;",
		"import Value = require(%s);",
		"declare module %s { export type Value = 7; }",
	}
	for _, spelling := range spellings {
		for i, form := range forms {
			t.Run(fmt.Sprintf("%s/%d", spelling.literal, i), func(t *testing.T) {
				t.Parallel()
				declaration := fmt.Sprintf(form, spelling.literal)
				var lookups []string
				exists := func(path string) bool {
					lookups = append(lookups, path)
					return path == tspath.ResolvePath("/src", spelling.stem+".vibe")
				}
				got := sidecarText(declaration, "/out/main.d.ts", "/src/main.vibe", exists, tspath.CaseSensitive)
				if spelling.want != "" {
					if want := fmt.Sprintf(form, spelling.want); got != want {
						t.Fatalf("got %q, want %q (lookups %q)", got, want, lookups)
					}
				} else if !strings.Contains(got, ".vibe") {
					t.Fatalf("decoded specifier not rewritten: %q (lookups %q)", got, lookups)
				}
			})
		}
	}
}

func TestSidecarTextEscapedNativeSpecifiersStayWritten(t *testing.T) {
	t.Parallel()
	for _, literal := range []string{"\"./caf\\u00e9.ts\"", "'./odd\\'name.js'", "\"./odd'name.js\""} {
		t.Run(literal, func(t *testing.T) {
			t.Parallel()
			declaration := "export * from " + literal + ";"
			got := sidecarText(declaration, "/out/main.d.ts", "/src/main.vibe", func(path string) bool { return strings.HasSuffix(path, ".vibe") || strings.HasSuffix(path, ".ts") }, tspath.CaseSensitive)
			if got != declaration {
				t.Fatalf("native declaration changed: got %q, want %q", got, declaration)
			}
		})
	}
}

// Decoding a module name must not make a package import source-relative.
func TestSidecarTextEscapedPackageSpecifiersStayWritten(t *testing.T) {
	t.Parallel()
	for _, declaration := range []string{
		"export * from \"caf\\u00e9.js\";",
		"export type Value = import('pack\\x61ge').Value;",
		"declare module \"pack'age\" {}",
	} {
		got := sidecarText(declaration, "/out/main.d.ts", "/src/main.vibe", func(string) bool {
			t.Fatal("non-relative module reached the filesystem fallback")
			return true
		}, tspath.CaseSensitive)
		if got != declaration {
			t.Fatalf("package declaration changed: got %q, want %q", got, declaration)
		}
	}
}
