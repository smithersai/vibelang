package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const nativeErrorClassQuote = "These built-in warnings suggest an accepted VibeLang form without changing the meaning of TypeScript-style source."
const nativeErrorClassFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestNativeErrorClassShapesQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{nativeErrorClassQuote, nativeErrorClassFixQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}

// D284, Chapter 7, and the proxy ruling of 2026-11-04: a native error
// with spread fields or a written static _tag has no declaration advisory
// or quick fix. The generator mutates the library binding, tag spelling,
// spread position and payload codec. Eligible controls live in
// TestNativeErrorClassShapes in the compiler package.
func FuzzNativeErrorClassShapes(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range []string{"schema-spread", "schema-static", "schema-both", "data-static"} {
		f.Add([]byte(key + ":0"))
		f.Add([]byte(key + ":7"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestNativeErrorClassShapesQuoted(t)
		const target = "FuzzNativeErrorClassShapes"
		defer recoverCompilerPanic(t, target)
		key, suffix, _ := strings.Cut(string(data), ":")
		keys := []string{"schema-spread", "schema-static", "schema-both", "data-static"}
		known := false
		for _, k := range keys {
			if k == key {
				known = true
			}
		}
		n := byte(0)
		for _, b := range []byte(suffix) {
			n ^= b
		}
		if !known {
			if len(data) != 0 {
				n = data[0]
			}
			key = keys[int(n)%len(keys)]
		}
		alias := n&1 != 0
		prefix := ""
		schema, tagged := "Schema", "Data.TaggedError"
		if alias {
			prefix = "import { Schema as S, Data as D } from \"effect\"\n"
			schema, tagged = "S", "D.TaggedError"
		}
		name := fmt.Sprintf("Native%d", n%8)
		fields := "id: " + schema + ".String"
		if n&2 != 0 {
			fields = "id: " + schema + ".Number"
		}
		spread := key == "schema-spread" || key == "schema-both"
		if spread {
			if n&4 != 0 {
				fields += ", ...shared"
			} else {
				fields = "...shared, " + fields
			}
		}
		base := tagged + "(" + fmt.Sprintf("%q", name) + ")<{ readonly id: string }>"
		if key != "data-static" {
			base = schema + ".TaggedError<" + name + ">()(" + fmt.Sprintf("%q", name) + ", { " + fields + " })"
		}
		member := ""
		if key != "schema-spread" {
			memberKey := []string{"_tag", "\"_tag\"", "[\"_tag\"]", "[tag]"}[int(n>>1)%4]
			member = "static readonly " + memberKey + " = " + fmt.Sprintf("%q", name)
		}
		source := prefix + "const tag = \"_tag\" as const\nconst shared = { cause: " + schema + ".Defect() }\nexport class " + name + " extends " + base + " { " + member + " }\n"
		project := Project{Files: map[string]string{"main.vibe": source}}
		before, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			t.Fatalf("invalid generated native class: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), source)
		}
		for _, d := range before.Diagnostics {
			if d.Code() == 4830 || d.Code() == 4837 {
				Gap(t, target, key, "native class drew advisory: %s\n%s", d.String(), source)
			}
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		for _, file := range fixed.Files {
			if file.Text != source {
				Gap(t, target, key+":fix", "native class was rewritten:\n%s\ninto:\n%s", source, file.Text)
			}
		}
	})
}
