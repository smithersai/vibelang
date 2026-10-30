package vibelangmapper

import (
	"strings"
	"testing"
)

func TestServicePropertyModifiers(t *testing.T) {
	text := Project("control Legacy { count: number }\nservice Counter { count: number; readonly label: string }", testContext).Text
	for _, want := range []string{
		"interface Legacy { readonly count: number;",
		"interface Counter { count: number; readonly label: string;",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
}
