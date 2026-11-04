package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSidecarEntryGlobsQuoted(t *testing.T) {
	for _, quote := range []string{"Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}
