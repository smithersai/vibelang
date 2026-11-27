package vibelangmapper

import (
	"strings"
	"testing"
)

func TestSchemaDataProjection(t *testing.T) {
	source := "export schema Address { readonly city: string }\nexport schema data Delivery {\n  Waiting\n  Sent { readonly tracking: string; note?: string; address: Address }\n}\n"
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", projection.Diagnostics)
	}
	for _, want := range []string{
		"type Delivery = typeof Delivery.Type;",
		"const Delivery = Schema.TaggedUnion({",
		"Waiting: {}",
		"Sent: { tracking: Schema.String",
	} {
		if !strings.Contains(projection.Text, want) {
			t.Fatalf("projection missing %q:\n%s", want, projection.Text)
		}
	}
	assertValidMap(t, projection, source)
	assertParses(t, projection.Text)
}
