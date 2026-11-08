package vibelangfuzz

import (
	"strings"
	"testing"
)

// Generated defect bridges preserve the call and handler, as the tooling
// chapter requires; the Effect twin independently checks the resulting Exit.
const generatedDefectBridgeQuote = "The inline catch mapper provably cannot throw and preserves the exact thrown value as a defect."
const caughtArgumentBridgeQuote = "When a throwing call appears inside a `catch` operand's arguments, the repair preserves the enclosing call's Effect result and the existing handler."

func TestGeneratedDefectBridgeQuoted(t *testing.T) {
	text := SpecText("007-tooling.md")
	for _, quote := range []string{generatedDefectBridgeQuote, caughtArgumentBridgeQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("generated defect bridge rule changed: %s", quote)
		}
	}
}
