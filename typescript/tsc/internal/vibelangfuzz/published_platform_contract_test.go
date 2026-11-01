package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublishedPlatformContractQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter7 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/test/published-platform-split.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("publication property must retain the safe-fix oracle")
	}
}
