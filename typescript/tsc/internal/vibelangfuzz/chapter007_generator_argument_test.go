package vibelangfuzz

import (
	"strings"
	"testing"
)

// Chapter 007 / ordinary generator runs are not inserted Effect runs: docs/design/src/007-tooling.md#a9dadf84dd548fb9
func TestChapter007GeneratorArgumentQuoted(t *testing.T) {
	const quote = "an ordinary async callable or native generator keeps its own `await` or `yield` rules."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("Chapter 001 no longer says %q", quote)
	}
}

// VIP-41 supplies throw-expression grammar; the JSX oracle uses a valid TS twin.
func TestChapter007ThrowNativeReferenceQuoted(t *testing.T) {
	const quote = "A throw expression follows [VIP-41](../vips/0041-throw-expressions.md) and its [pinned TC39 proposal](../vips/tc39-throw-expressions/README.md)."
	if !strings.Contains(SpecText("003-failures.md"), quote) {
		t.Fatalf("Chapter 003 no longer says %q", quote)
	}
}
