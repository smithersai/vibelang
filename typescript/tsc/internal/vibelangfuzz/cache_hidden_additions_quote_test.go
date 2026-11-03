package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHiddenCacheAdditionsQuoted(t *testing.T) {
	quote := "Fields retain their TypeScript meaning with one deliberate file-kind exception:"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter7 no longer says %q", quote)
	}
	quote = "`.vibe` and `.vibex` are supported source extensions:"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("review native extension cache coverage: %q", quote)
	}
	readme, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	quote = "A file added to or removed from a directory the tsconfig's `include` scans"
	if !strings.Contains(string(readme), quote) {
		t.Fatalf("review the included-file cache oracle: %q", quote)
	}
}
