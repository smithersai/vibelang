package vibelangfuzz

import (
	"strings"
	"testing"
)

const catchScopeFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestCatchScopeFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), catchScopeFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", catchScopeFixQuote)
	}
}
