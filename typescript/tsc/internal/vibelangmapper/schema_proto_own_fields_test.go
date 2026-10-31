package vibelangmapper

import (
	"strings"
	"testing"
)

// Detail 111: schema field objects use own computed "__proto__" keys.
func TestSchemaProtoOwnFieldProjection(t *testing.T) {
	for _, declaration := range []string{"schema", "schema error"} {
		for _, name := range []string{"__proto__", `"__proto__"`, `"__pro\u0074o__"`, `__pro\u0074o__`} {
			t.Run(declaration+"/"+name, func(t *testing.T) {
				source := "export " + declaration + " E { readonly " + name + ": string }\n"
				projection := Project(source, testContext)
				if len(projection.Diagnostics) != 0 {
					t.Fatalf("unexpected diagnostics: %v", projection.Diagnostics)
				}
				if !strings.Contains(projection.Text, `["__proto__"]: Schema.String`) {
					t.Fatalf("schema must create an own proto field: %s", projection.Text)
				}
				assertValidMap(t, projection, source)
				assertParses(t, projection.Text)
			})
		}
	}
	t.Run("nested struct", func(t *testing.T) {
		source := `export schema E { readonly value: { readonly __proto__: string } }`
		projection := Project(source, testContext)
		if len(projection.Diagnostics) != 0 || !strings.Contains(projection.Text, `Schema.Struct({ ["__proto__"]: Schema.String })`) {
			t.Fatalf("nested schema must create an own proto field: %s; %v", projection.Text, projection.Diagnostics)
		}
		assertValidMap(t, projection, source)
		assertParses(t, projection.Text)
	})
	t.Run("ordinary object keeps JavaScript setter semantics", func(t *testing.T) {
		source := "export const value = { __proto__: null };"
		projection := Project(source, testContext)
		if strings.Contains(projection.Text, `["__proto__"]`) || !strings.Contains(projection.Text, "{ __proto__: null }") {
			t.Fatalf("ordinary object changed: %s", projection.Text)
		}
		assertParses(t, projection.Text)
	})
}
