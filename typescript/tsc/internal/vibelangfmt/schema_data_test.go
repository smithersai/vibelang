package vibelangfmt

import (
	"strings"
	"testing"
)

func TestFormatSchemaData(t *testing.T) {
	source := "export schema   data   Shape {\n  Empty\n  Circle { readonly radius: number; label?: string }\n}\n"
	identity := func(text string) (string, error) { return text, nil }
	got, err := Format("shape.vibe", source, identity)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "export schema data Shape {") {
		t.Fatalf("expected normalized header, got:\n%s", got)
	}
	if !strings.Contains(got, "Circle { readonly radius: number; label?: string }") {
		t.Fatalf("expected variant preserved, got:\n%s", got)
	}
	again, err := Format("shape.vibe", got, identity)
	if err != nil || again != got {
		t.Fatalf("format not idempotent: %v\n%s\n%s", err, got, again)
	}
}
