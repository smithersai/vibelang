package vibelangfuzz

import (
	"strings"
	"testing"
)

const implicitDefectBridgeQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestImplicitGeneratorDefectBridgeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), implicitDefectBridgeQuote) {
		t.Fatal("missing preserving quick-fix rule")
	}
	if !strings.Contains(SpecText("007-tooling.md"), "The inline catch mapper provably cannot throw and preserves the exact thrown value as a defect.") {
		t.Fatal("missing native defect identity rule")
	}
}
