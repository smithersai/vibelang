package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The Node property's oracle is checked in the fast gate too: a chapter edit
// must update both its exact quote and the generated neighbourhood together.
func TestMigrationDeclarationCanonicalizationQuoted(t *testing.T) {
	const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter 1 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/test/parentheses.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("Node declaration property no longer cites the checked contract")
	}
}
