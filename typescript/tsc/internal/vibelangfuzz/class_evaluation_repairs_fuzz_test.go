package vibelangfuzz

import (
	"strings"
	"testing"
)

const classEvaluationRepairQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestClassEvaluationRepairsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), classEvaluationRepairQuote) {
		t.Fatal(classEvaluationRepairQuote)
	}
}
