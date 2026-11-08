package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSyncBuiltinCallBridgeQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatal("preserving repair rule moved")
	}
}
