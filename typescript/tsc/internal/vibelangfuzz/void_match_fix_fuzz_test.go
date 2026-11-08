package vibelangfuzz

import (
	"strings"
	"testing"
)

const voidMatchFixTarget = "FuzzVoidMatchFix"
const voidMatchFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

// Alchemy's match-arm rewrite has a safe canonical value; Chapter 7 requires
// that applying it keep valid syntax and the original declaration. Inferred
// exports distinguish void from undefined, and a local undefined must not
// capture the replacement. The keyed source corpus is the migration witness.
func TestVoidMatchFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), voidMatchFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", voidMatchFixQuote)
	}
}
