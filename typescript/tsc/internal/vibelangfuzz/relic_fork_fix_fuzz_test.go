package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const relicForkFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestRelicForkFixQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil || !strings.Contains(string(text), relicForkFixQuote) {
		t.Fatalf("missing preserving-fix authority: %v", err)
	}
}
