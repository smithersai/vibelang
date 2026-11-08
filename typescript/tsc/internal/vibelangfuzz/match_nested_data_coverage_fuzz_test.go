package vibelangfuzz

import (
	"strings"
	"testing"
)

const nestedDataCoverageQuote = "when every other property it tests is a bare key or a `let` or `const` binding that the member declares as required"

func TestNestedDataMatchCoverageQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), nestedDataCoverageQuote) {
		t.Fatal("nested data coverage quote changed")
	}
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatal("declaration-preserving repair quote changed")
	}
}
