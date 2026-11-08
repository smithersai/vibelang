package vibelangfuzz

import (
	"strings"
	"testing"
)

const platformRunnerPipeTarget = "FuzzPlatformRunnerPipeFix"
const platformRunnerPipeQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestPlatformRunnerPipeFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), platformRunnerPipeQuote) {
		t.Fatal("preserving quick-fix rule moved")
	}
}
