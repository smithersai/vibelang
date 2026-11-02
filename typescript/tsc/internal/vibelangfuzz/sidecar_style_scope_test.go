package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSidecarStyleScopeQuoted(t *testing.T) {
	const quote = "`allowArbitraryExtensions` resolves it, so plain `tsc` and TypeDoc understand imports of `.vibe` files."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter 1 no longer says %q", quote)
	}
}
