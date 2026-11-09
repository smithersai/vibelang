package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestServiceAccessMigrationQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
	if !strings.Contains(SpecText("005-services.md"), "const users = try Users") {
		t.Fatal("review the service/reference migration controls against chapter5")
	}
}
