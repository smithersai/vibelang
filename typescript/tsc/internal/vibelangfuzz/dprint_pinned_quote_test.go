package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestDprintPinnedSetupQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "Prettier, dprint and Oxfmt reach it through plugins, so a repository's existing formatter command covers `.vibe` files.") {
		t.Fatal("missing tooling contract for existing pinned formatter configurations")
	}
}
