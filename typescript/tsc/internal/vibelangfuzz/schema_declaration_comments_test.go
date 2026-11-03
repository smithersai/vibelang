// 006-data.md: removeComments and stripInternal preserve native declaration behavior
// rule: docs/design/src/006-data.md#6f42980fb6df70ed
// 006-data.md: schema and data JSDoc attachment and declaration emission
// rule: docs/design/src/006-data.md#f5211dee12b7b0f9
package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const schemaCommentQuote = "A JSDoc comment on a `schema` declaration is emitted on its `declare const` only; its synthesized `typeof Name.Type` alias has no comment."

func requireSchemaCommentQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("006-data.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), schemaCommentQuote) {
		t.Fatalf("chapter 006 lost %q", schemaCommentQuote)
	}
}

func TestSchemaDeclarationCommentsQuoted(t *testing.T) { requireSchemaCommentQuote(t) }

// Chapter 006's exact Effect pair is the independent reference. Comparing
// complete declarations retains comments; migration canonicalization must not
// erase the very attachment this oracle checks.
// Chapter 007 / schema value JSDoc and native stripInternal elision match TS pair: docs/design/src/007-tooling.md#12bd28224f0f004b
// Chapter 007 / schema value JSDoc and native stripInternal elision match TS pair: docs/design/src/007-tooling.md#ec1ebe136fb0ea02
// Chapter 007 / schema value JSDoc and native stripInternal elision match TS pair: docs/design/src/007-tooling.md#da5fe373bf92b742
// Chapter 007 / schema value JSDoc and native stripInternal elision match TS pair: docs/design/src/007-tooling.md#58c234ae8e4cabe8
// Chapter 007 / schema value JSDoc and native stripInternal elision match TS pair: docs/design/src/007-tooling.md#e2c0f97ce6e2a074
// Chapter 007 / schema value JSDoc and native stripInternal elision match TS pair: docs/design/src/007-tooling.md#94e926a495759a8e

func FuzzSchemaDeclarationComments(f *testing.F) {
	startShortBudget(f)
	requireSchemaCommentQuote(f)
	docs := map[string]string{
		"none": "", "one-line": "/** Wire message. */",
		"multiline": "/** First line.\n * Second line.\n */",
		"internal":  "/** @internal */", "public": "/** @public */",
		"deprecated": "/** @deprecated Use another schema. */",
		"tags":       "/** Wire message.\n * @public\n * @deprecated Use another schema.\n */",
		"line":       "// ordinary comment",
	}
	for _, key := range []string{"none", "one-line", "multiline", "internal", "public", "deprecated", "tags", "line"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		doc, ok := docs[key]
		if !ok {
			key, doc = "one-line", docs["one-line"]
		}
		kind, twin := "schema Message { readonly id: string }", "const Message = Schema.Struct({ id: Schema.String })"
		if mode&1 != 0 {
			kind, twin = `schema Message = "ok" | "no"`, `const Message = Schema.Literals(["ok", "no"])`
		}
		prefix := "import * as Schema from \"effect/Schema\"\n" + doc + "\nexport "
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out","removeComments":%t,"stripInternal":%t}}`, mode&2 != 0, mode&4 != 0)
		compile := func(name, source string) *Result {
			r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{name: source}})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("%s: %v", name, r.Diagnostics)
				}
			}
			return r
		}
		vibe := compile("main.vibe", prefix+kind+"\n")
		reference := compile("main.ts", prefix+twin+"\nexport type Message = typeof Message.Type\n")
		got, exists := vibe.Outputs["out/main.d.ts"]
		want, controlExists := reference.Outputs["out/main.d.ts"]
		if !exists || !controlExists {
			t.Fatal("missing declaration output")
		}
		gapKey := "schema-doc:" + key
		if key == "internal" && mode&4 != 0 {
			gapKey += ":stripInternal"
		}
		if got != want {
			Gap(t, "FuzzSchemaDeclarationComments", gapKey, "mode %d: schema declaration differs from chapter 006's Effect pair\ngot:\n%s\nwant:\n%s", mode, got, want)
		}
		ExpectPending(t, "FuzzSchemaDeclarationComments", gapKey)
	})
}
