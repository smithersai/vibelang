package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestDprintPinnedSetupQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "Existing tools work.") {
		t.Fatal("missing tooling contract for existing pinned formatter configurations")
	}
}
