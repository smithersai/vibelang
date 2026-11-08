package vibelangfuzz

import (
	"strings"
	"testing"
)

const capturedPipeASITarget = "FuzzCapturedPipeStatementBoundaries"
const capturedPipeASIQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestCapturedPipeASIQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), capturedPipeASIQuote) {
		t.Fatal("quick-fix preservation rule moved")
	}
}

const capturedPipeContinuationTarget = "FuzzCapturedPipeStatementContinuations"

func TestCapturedPipeContinuationsQuoted(t *testing.T) {
	TestCapturedPipeASIQuoted(t)
}
