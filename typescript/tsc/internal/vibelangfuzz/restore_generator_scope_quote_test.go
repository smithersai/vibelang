package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestRestoreGeneratorScopeQuoted(t *testing.T) {
	for _, quote := range []string{
		"or inside any `for concurrent` head binding initialization or body",
		"A nested effect callable or `effect` block may introduce its own `uninterruptible` mask and restore that one.",
	} {
		if !strings.Contains(SpecText("002-running.md"), quote) {
			t.Fatalf("Chapter2 no longer says %q", quote)
		}
	}
}
