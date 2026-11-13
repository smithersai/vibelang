package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const serviceReadonlyUpgradeQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func serviceReadonlyUpgradeQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), serviceReadonlyUpgradeQuote) {
		t.Fatalf("chapter 7 no longer says %q", serviceReadonlyUpgradeQuote)
	}
}
func TestServiceReadonlyUpgradeQuoted(t *testing.T) { serviceReadonlyUpgradeQuoted(t) }
