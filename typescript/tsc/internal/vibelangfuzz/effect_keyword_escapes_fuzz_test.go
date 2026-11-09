package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const effectEscapeQuote = "`effect` goes exactly where TypeScript allows `async`, and nowhere else (VIP-1)"

func TestEffectKeywordEscapesQuoted(t *testing.T) { requireEffectEscapeQuote(t) }
func requireEffectEscapeQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectEscapeQuote) {
		t.Fatalf("chapter 001 no longer contains %q", effectEscapeQuote)
	}
}
