package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const serviceShapeShadowQuote = "whose members are TypeScript [Member]"

func serviceShapeShadowQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), serviceShapeShadowQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceShapeShadowQuote)
	}
}

func TestServiceShapeShadowQuoted(t *testing.T) { serviceShapeShadowQuoted(t) }
