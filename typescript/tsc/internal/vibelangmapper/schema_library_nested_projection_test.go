package vibelangmapper

import (
	"strings"
	"testing"
)

// VIP-44 mappings compose in the TypeScript projection too.
func TestSchemaNestedLibraryTypeProjection(t *testing.T) {
	for _, row := range []struct{ name, field, want string }{
		{"array-of-map", "ReadonlyArray<ReadonlyMap<string, number>>", "Schema.Array(Schema.ReadonlyMap(Schema.String, Schema.Number))"},
		{"mutable-array-of-map", "Array<ReadonlyMap<string, number>>", "Schema.mutable(Schema.Array(Schema.ReadonlyMap(Schema.String, Schema.Number)))"},
		{"set-of-record", "ReadonlySet<Record<string, number>>", "Schema.ReadonlySet(Schema.Record(Schema.String, Schema.mutableKey(Schema.Number)))"},
		{"set-of-map", "ReadonlySet<ReadonlyMap<string, Date>>", "Schema.ReadonlySet(Schema.ReadonlyMap(Schema.String, Schema.Date))"},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "schema Order { readonly at: " + row.field + " }"
			got := Project(source, testContext)
			if len(got.Diagnostics) != 0 {
				t.Fatalf("library schema rejected: %+v\n%s", got.Diagnostics, got.Text)
			}
			if !strings.Contains(got.Text, row.want) {
				t.Fatalf("want %s\n%s", row.want, got.Text)
			}
		})
	}
}
