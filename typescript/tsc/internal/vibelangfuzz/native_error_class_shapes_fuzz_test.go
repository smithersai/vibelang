package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const nativeErrorClassQuote = "These built-in warnings suggest an accepted VibeLang form without changing the meaning of TypeScript-style source."
const nativeErrorClassFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestNativeErrorClassShapesQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{nativeErrorClassQuote, nativeErrorClassFixQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}
