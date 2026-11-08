package vibelangfuzz

import (
	"strings"
	"testing"
)

const schemaContextualHoistQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestSchemaErrorContextualHoistQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), schemaContextualHoistQuote) {
		t.Fatalf("chapter 007 lost %q", schemaContextualHoistQuote)
	}
}
