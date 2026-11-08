package vibelangmapper

import (
	"strings"
	"testing"
)

func TestSchemaQualifiedLibraryProjection(t *testing.T) {
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		source := "export schema S { readonly value: globalThis." + name + " }"
		got := Project(source, testContext)
		want := "Schema." + name
		if name == "Error" {
			want = "Schema.Defect().pipe(Schema.refine("
		}
		if len(got.Diagnostics) != 0 || !strings.Contains(got.Text, want) {
			t.Fatalf("want %s: %+v\n%s", want, got.Diagnostics, got.Text)
		}
	}
}
