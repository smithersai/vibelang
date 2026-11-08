package vibelangfuzz

import (
	"testing"
)

func TestNativeTryContextualReturnQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", catchCompletionAPIQuote)
	chapterSays(t, "002-running.md", nativeTryQuote)
}
