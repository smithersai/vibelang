package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

func TestNativeGeneratorRefusalReasonQuoted(t *testing.T) {
	nativeGeneratorRefusalReasonChapter(t)
}

func nativeGeneratorRefusalReasonChapter(t testing.TB) {
	t.Helper()
	nativeGeneratorsChapter(t)
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	quote := "otherwise the diagnostic explains why it has no automatic fix"
	if !strings.Contains(string(text), quote) {
		t.Fatalf("quick-fix chapter no longer says %q", quote)
	}
}
