package vibelangfuzz

import (
	"strings"
	"testing"
)

const migrationCallbackContractQuote = "a type without `@throws` admits only `never`"

func TestMigrationCallbackContractQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), migrationCallbackContractQuote) {
		t.Fatalf("Chapter 3 no longer says %q", migrationCallbackContractQuote)
	}
}
