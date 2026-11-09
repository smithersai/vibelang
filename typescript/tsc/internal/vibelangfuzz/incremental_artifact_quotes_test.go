package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestIncrementalArtifactIdentityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), "Members are checked against the program's `ImportMeta` declarations.") {
		t.Fatal("Chapter 5 metadata typing changed; review the real incremental artifact corpus")
	}
}
