package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReviewDiagnosticTablesQuoted(t *testing.T) {
	const quote = "a variant named `$is` or `$match`, generic data included; rename it and its resolved references to a fresh name"
	if !strings.Contains(SpecText("006-data.md"), quote) {
		t.Fatalf("Chapter 6 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), "docs/tools/diagnostic-tables.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("Node table property no longer cites the checked rule")
	}
}
