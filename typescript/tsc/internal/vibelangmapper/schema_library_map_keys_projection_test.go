package vibelangmapper

import (
	"strings"
	"testing"
)

// VIP-44: a ReadonlyMap key is any schema in the TypeScript projection too.
func TestSchemaLibraryMapKeyProjection(t *testing.T) {
	for _, row := range []struct{ name, field, want string }{
		{"date-key", "ReadonlyMap<Date, number>", "Schema.ReadonlyMap(Schema.Date, Schema.Number)"},
		{"set-key", "ReadonlyMap<ReadonlySet<string>, number>", "Schema.ReadonlyMap(Schema.ReadonlySet(Schema.String), Schema.Number)"},
		{"tuple-key", "ReadonlyMap<readonly [string, number], string>", "Schema.ReadonlyMap(Schema.Tuple([Schema.String, Schema.Number]), Schema.String)"},
		{"array-of-date-key-map", "ReadonlyArray<ReadonlyMap<Date, number>>", "Schema.Array(Schema.ReadonlyMap(Schema.Date, Schema.Number))"},
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
