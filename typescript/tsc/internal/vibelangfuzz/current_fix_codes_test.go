package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

// Current tooling names this codemod and preserves the existing safety rules.
// Historical code-range membership is not a current completion oracle.
func TestCurrentFixCodesQuoted(t *testing.T) {
	text := currentSpecText(toolingChapter)
	for _, quote := range []string{currentFixCodesQuote, currentFixSafetyQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("current tooling no longer says %q", quote)
		}
	}
	if got := toolsFixCodes(); !slices.Equal(got, []int32{1101}) {
		t.Fatalf("current named codemod codes = %v; want EK1101 without historical ranges", got)
	}
	if !SpecHasCode(1101) {
		t.Fatal("the named EK1101 codemod has no current registry assignment")
	}
}
