package vibelangfuzz

import (
	"strings"
	"testing"
)

const namedServiceClassFixTarget = "FuzzNamedServiceClassFix"
const namedServiceClassFixQuote = "the TypeScript type annotation supplies the exact Shape"
const namedServiceClassFixIdentityQuote = "This form adds no shape helper and no namespace"

const namedServiceClassFixAPIQuote = "the same exported names, each export's type identical to \x60tsc\x60's in both directions (a type-level check), and the same doc comment on each export, with one exception:"

func TestNamedServiceClassFixQuoted(t *testing.T) {
	for _, quote := range []string{namedServiceClassFixQuote, namedServiceClassFixIdentityQuote} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("VIP-9 whole-shape authority no longer says %q", quote)
		}
	}
	if !strings.Contains(SpecText("001-functions.md"), namedServiceClassFixAPIQuote) {
		t.Fatal("API identity authority changed")
	}
}
