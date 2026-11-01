package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSchemaBuiltinBindingsQuoted(t *testing.T) {
	chapter := SpecText("006-data.md")
	for _, quote := range []string{
		"selected by ordinary type lookup and alias resolution, not by spelling",
		"a value-only binding does not by itself replace the separate library type binding",
		"This does not expand arbitrary user type aliases or introduce generic Schema declarations.",
	} {
		if !strings.Contains(chapter, quote) {
			t.Errorf("chapter 006 lost %q", quote)
		}
	}
}
