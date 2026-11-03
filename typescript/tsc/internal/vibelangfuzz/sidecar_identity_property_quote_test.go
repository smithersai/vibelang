package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestSidecarIdentityPropertyQuoted(t *testing.T) {
	const quote = "A non-relative import reaching a known compatibility declaration uses its available mapped source only when TypeScript's final resolved path is outside `node_modules`. This includes package exports, `paths` and package `#imports`."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}
