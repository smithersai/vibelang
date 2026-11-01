package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestLabelChainRulesQuoted(t *testing.T) {
	const quote = "**Source bindings and control flow survive lowering.** Bindings and jump targets are resolved on the source before any callback is introduced."
	if !strings.Contains(SpecText("008-runtime.md"), quote) {
		t.Fatalf("label-chain oracle needs review: 008-runtime.md no longer says %q", quote)
	}
}
