package vibelangfuzz

import (
	"strings"
	"testing"
)

const catchScopeFixQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func TestMigrationGenericRequirementsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), catchScopeFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", catchScopeFixQuote)
	}
}
