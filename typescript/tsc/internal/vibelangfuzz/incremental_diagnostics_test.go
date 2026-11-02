package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestIncrementalDiagnosticsQuoted(t *testing.T) {
	const quote = "apply throughout `.vibe`, including plain functions and wrapper arrows (VIP-33)."
	if !strings.Contains(SpecText("000-intro.md"), quote) {
		t.Fatalf("Chapter 0 no longer says %q", quote)
	}
}
