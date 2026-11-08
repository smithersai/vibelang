package vibelangfuzz

import (
	"strings"
	"testing"
)

const nothrowPreservingTarget = "FuzzNothrowPreservingFix"

var nothrowPreservingQuotes = []string{
	"or move the code to a `.ts` file.",
	"A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output",
}

func TestNothrowPreservingQuoted(t *testing.T) {
	for i, q := range nothrowPreservingQuotes {
		chapter := "003-failures.md"
		if i == 1 {
			chapter = "007-tooling.md"
		}
		if !strings.Contains(SpecText(chapter), q) {
			t.Fatalf("%s no longer says %q", chapter, q)
		}
	}
}
