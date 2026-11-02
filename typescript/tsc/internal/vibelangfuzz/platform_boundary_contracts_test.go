package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestPlatformBoundaryContractsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"007-tooling.md":  "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output",
		"005-services.md": "The quick fix and the codemod move the code into a sibling",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}
