package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestInferredEffectDefaultsQuoted(t *testing.T) {
	const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter 1 no longer says %q", quote)
	}
}
