package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

// A generated Self reference on the declaration token must not turn a new-name
// completion context into a use-site probe. Real references remain required.
func TestEditorProjectedDeclarationReferences(t *testing.T) {
	for _, keyword := range []string{"error", "schema error"} {
		for _, scope := range []string{"local", "export", "namespace"} {
			t.Run(keyword+"/"+scope, func(t *testing.T) {
				body := keyword + " Problem { id: string }\nconst value = new Problem({ id: \"ok\" })\n"
				if scope == "export" {
					body = "export " + body
				} else if scope == "namespace" {
					body = "namespace Nested {\n" + body + "}\n"
				}
				source := "import * as Schema from \"effect/Schema\"\n" + body
				files := map[string]string{"main.vibe": source}
				w := NewWorkspace(t)
				r, err := w.Compile(t.Context(), Project{Files: files})
				if err != nil {
					t.Fatal(err)
				}
				defer r.Remove()
				e := &toolsEditor{t: t, ctx: t.Context(), r: r, files: files, main: "main.vibe"}
				got := e.declaredReferences()
				declaration, reference := strings.Index(source, "Problem"), strings.LastIndex(source, "Problem")
				if slices.Contains(got, declaration) {
					t.Errorf("declaration token %d was selected as a reference: %v", declaration, got)
				}
				if !slices.Contains(got, reference) {
					t.Errorf("actual reference %d was lost: %v", reference, got)
				}
			})
		}
	}
}
