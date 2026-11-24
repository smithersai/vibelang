package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

var chapter007ServiceReadQuotes = []string{
	"Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.",
}

func TestChapter007ServiceReadHygieneQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range chapter007ServiceReadQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing Chapter 007 service type-read rule: %s", quote)
		}
	}
}
