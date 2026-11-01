package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBunRolldownBarrelContractQuoted(t *testing.T) {
	const quote = "Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter7 no longer says %q", quote)
	}
	source, err := os.ReadFile(filepath.Join(Root(), "packages/unplugin/test/workspace-barrels.property.test.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), quote) {
		t.Fatal("Bun/Rolldown property and spec gate must share the oracle")
	}
}
