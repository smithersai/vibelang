package parser

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

// TestVibeLangKeywordsCoverParser checks that VibeLangKeywords lists every
// word the parser reads as VibeLang syntax: each word a form tests the
// current token against. A keyword missing from the list would leave an
// Effect export of that name a global that the keyword hides (VIP-6).
func TestVibeLangKeywordsCoverParser(t *testing.T) {
	files, err := filepath.Glob("vibelang*.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("no parser sources: %v", err)
	}
	word := regexp.MustCompile(`(?:TokenValue\(\) == |isMatchWord\()"(\w+)"`)
	found := 0
	for _, file := range files {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range word.FindAllStringSubmatch(string(source), -1) {
			found++
			if !slices.Contains(VibeLangKeywords, m[1]) {
				t.Errorf("%s reads %q as VibeLang syntax, but VibeLangKeywords does not list it", file, m[1])
			}
		}
	}
	if found < 10 {
		t.Errorf("found %d keyword tests in the parser; the pattern no longer matches how forms test their words", found)
	}
}
