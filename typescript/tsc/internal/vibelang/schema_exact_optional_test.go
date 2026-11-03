package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// An inverse rewrite must retain the original Effect codec's optionality
// under the active setting, including writable-key wrapping.
func TestSchemaExactOptionalInverse(t *testing.T) {
	for _, exact := range []bool{false, true} {
		for _, wrapper := range []string{"optional", "optionalKey"} {
			for _, mutable := range []bool{false, true} {
				name := wrapper + map[bool]string{false: "/default", true: "/exact"}[exact] + map[bool]string{false: "/readonly", true: "/writable"}[mutable]
				t.Run(name, func(t *testing.T) {
					value := "Schema." + wrapper + "(Schema.String)"
					if mutable {
						value = "Schema.mutableKey(" + value + ")"
					}
					source := "export const S = Schema.Struct({ value: " + value + " })\n"
					program, file, _, _ := editorProgram(t, source)
					program.Options().ExactOptionalPropertyTypes = core.BoolToTristate(exact)
					c, done := program.GetTypeCheckerForFile(t.Context(), file)
					defer done()
					c.GetDiagnostics(t.Context(), file)
					found := false
					var visit func(*ast.Node) bool
					visit = func(node *ast.Node) bool {
						if ast.IsPropertyAssignment(node) && node.Name().Text() == "value" {
							found = true
							text, ok := structFieldType(c, file, node, "  ")
							want := wrapper == "optional" && !exact
							if ok != want {
								t.Fatalf("exact=%t wrapper=%s: convertible=%t want=%t (%s)", exact, wrapper, ok, want, text)
							}
							if ok && (!strings.Contains(text, "value?") || strings.Contains(text, "mutable ") != mutable) {
								t.Fatalf("lost source key flags: %s", text)
							}
						}
						return node.ForEachChild(visit)
					}
					file.AsNode().ForEachChild(visit)
					if !found {
						t.Fatal("missing control field")
					}
				})
			}
		}
	}
}
