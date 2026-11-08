package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

// VIP-21 admits native generators; VIP-34 keeps ordinary --fix teaching
// rewrites and excludes them from --fix-migration-only.
func nativeGeneratorTeachingChapter(t testing.TB) {
	nativeGeneratorsChapter(t)
	text, err := os.ReadFile(SpecPath("../vips/0034-compiler-and-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	quote := "excluding TypeScript-form teaching rewrites"
	if !strings.Contains(string(text), quote) {
		t.Fatalf("VIP-34 no longer says %q", quote)
	}
}
