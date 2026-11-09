package vibelangfuzz

import (
	"strings"
	"testing"
)

const plainFnRefusalQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

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
