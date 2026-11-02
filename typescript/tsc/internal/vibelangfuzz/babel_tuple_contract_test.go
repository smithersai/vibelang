package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBabelTupleConsumerQuoted(t *testing.T) {
	const quote = "Existing tools work."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/test/babel-preset.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("Babel consumer property must retain its tooling oracle")
	}
}
