package vibelangmapper

import (
	"strings"
	"testing"
)

// VIP-44: the projection writes the library type's Schema unless a lexical
// declaration of the same name shadows it.
func TestSchemaLibraryTypeProjection(t *testing.T) {
	for _, row := range []struct{ name, head, field, want string }{
		{"date", "", "Date", "Schema.Date"},
		{"url", "", "URL", "Schema.URL"},
		{"regexp", "", "RegExp", "Schema.RegExp"},
		{"bytes", "", "Uint8Array", "Schema.Uint8Array"},
		{"set", "", "ReadonlySet<string>", "Schema.ReadonlySet(Schema.String)"},
		{"map", "", "ReadonlyMap<string, number>", "Schema.ReadonlyMap(Schema.String, Schema.Number)"},
		{"shadow", "schema Date { readonly iso: string }", "Date", "at: Date"},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := row.head + " schema Order { readonly at: " + row.field + " }"
			got := Project(source, testContext)
			if len(got.Diagnostics) != 0 {
				t.Fatalf("library schema rejected: %+v\n%s", got.Diagnostics, got.Text)
			}
			if !strings.Contains(got.Text, row.want) {
				t.Fatalf("want %q in:\n%s", row.want, got.Text)
			}
			assertValidMap(t, got, source)
			assertParses(t, got.Text)
		})
	}
}
