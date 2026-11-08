package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestAutomaticCatchDataPreservationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output") {
		t.Fatal("automatic repair preservation authority changed")
	}
	TestCatchErrorDataAdvisoryQuoted(t)
}
