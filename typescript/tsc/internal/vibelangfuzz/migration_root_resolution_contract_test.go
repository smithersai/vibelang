package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationRootResolutionQuoted(t *testing.T) {
	const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter1 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/test/unresolved-root-preservation.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("root-resolution property must retain the declaration oracle")
	}
}
