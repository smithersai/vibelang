package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSchemaFactoryMigrationReturnsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), schemaWrittenMutabilityQuote) {
		t.Fatal("missing TypeScript mutability rule")
	}
}
