package vibelangfuzz

import (
	"strings"
	"testing"
)

const catchMissingArrowQuote = "For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression."

const catchMissingArrowRepairQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func TestCatchMissingArrowQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), catchMissingArrowQuote) {
		t.Fatal("VIP-5 missing-arrow recovery quote changed")
	}
	if !strings.Contains(SpecText("007-tooling.md"), catchMissingArrowRepairQuote) {
		t.Fatal("preserving repair rule changed")
	}
}
