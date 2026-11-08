package vibelangfuzz

import (
	"strings"
	"testing"
)

const plainFnRefusalQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestPlainFnRefusalQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), plainFnRefusalQuote) {
		t.Fatal("Chapter 7 changed its refusal rule")
	}
}

var plainFnRefusalKeys = []string{
	"direct-arrow", "direct-block", "direct-function",
	"named-arrow", "named-block", "named-function",
	"options-arrow", "options-block", "options-function",
}
