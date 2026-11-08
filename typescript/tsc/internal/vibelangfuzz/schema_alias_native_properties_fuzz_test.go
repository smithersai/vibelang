package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSchemaAliasNativePropertiesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), "Mappings preserve TypeScript mutability: properties are writable unless `readonly`") {
		t.Fatal("native schema mutability authority changed")
	}
}
