package vibelangfuzz

import (
	"strings"
	"testing"
)

const plainInferCallbackTarget = "FuzzPlainInferCallbackFix"
const plainInferCallbackQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestPlainInferCallbackFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), plainInferCallbackQuote) {
		t.Fatal("missing callback migration preservation rule")
	}
	if !strings.Contains(SpecText("001-functions.md"), "delete a bare \x60: infer _\x60") {
		t.Fatal("missing legacy plain return migration rule")
	}
}
