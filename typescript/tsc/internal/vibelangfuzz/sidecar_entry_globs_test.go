package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSidecarEntryGlobsQuoted(t *testing.T) {
	for _, quote := range []string{"Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}
