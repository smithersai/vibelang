package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestIncrementalArtifactIdentityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), "`import.meta` may appear only as the object of `.url`") {
		t.Fatal("Chapter5 metadata boundary changed; review the real incremental artifact corpus")
	}
}
