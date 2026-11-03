package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestMigrationGenericRequirementsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), catchScopeFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", catchScopeFixQuote)
	}
}
