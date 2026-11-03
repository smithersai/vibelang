package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

func TestLazyReceiverNamesQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	const quote = "A value-only evaluation of an anonymous function or class cannot gain a name from a private variable or assignment; preserve a name the source explicitly requests."
	if !strings.Contains(string(text), quote) {
		t.Fatalf("VIP-1 Source names no longer says %q", quote)
	}
}
