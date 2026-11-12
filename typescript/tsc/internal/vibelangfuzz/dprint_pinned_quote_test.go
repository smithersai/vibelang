package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestDprintPinnedSetupQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "Prettier and dprint reach it through plugins, so a repository's existing formatter command covers `.vibe` files. Oxfmt has no plugin interface, so a repository's Oxfmt format and check scripts run `vibelang-format` after Oxfmt") {
		t.Fatal("missing tooling contract for existing pinned formatter configurations")
	}
}
