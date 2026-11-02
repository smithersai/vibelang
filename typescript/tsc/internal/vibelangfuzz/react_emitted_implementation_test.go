package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestReactEmittedImplementationQuoted(t *testing.T) {
	const quote = "Every tool is tested against the dogfood repositories."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}
