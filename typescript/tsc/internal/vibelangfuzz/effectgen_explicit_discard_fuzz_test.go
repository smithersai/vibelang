package vibelangfuzz

import (
	"strings"
	"testing"
)

const explicitDiscardTarget = "FuzzEffectGenExplicitDiscards"
const explicitDiscardQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestEffectGenExplicitDiscardsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), explicitDiscardQuote) {
		t.Fatalf("Chapter 7 no longer says %q", explicitDiscardQuote)
	}
}
