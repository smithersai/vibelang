package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const relicTryRejectionQuote = "At the start of a statement, `try` followed by `{`, on the same line or not, begins a `try` statement, as in JavaScript, and that is an error in effect code."

func TestRelicTryRejectionQuoted(t *testing.T) { requireRelicTryRejectionQuote(t) }
func requireRelicTryRejectionQuote(t testing.TB) {
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil || !strings.Contains(string(text), relicTryRejectionQuote) {
		t.Fatalf("missing retired-try rejection authority: %v", err)
	}
}
