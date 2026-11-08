package vibelangfuzz

import (
	"strings"
	"testing"
)

const legacyEffectGlobalFixQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func legacyEffectGlobalFixCited(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("../vips/0006-effect-globals.md"), effectGlobalsQuote) {
		t.Fatal("VIP-6 global rule changed")
	}
	if !strings.Contains(SpecText("007-tooling.md"), legacyEffectGlobalFixQuote) {
		t.Fatal("migration preservation rule changed")
	}
}

func TestLegacyEffectGlobalFixQuoted(t *testing.T) { legacyEffectGlobalFixCited(t) }

var legacyEffectGlobalFixKeys = []string{"scope-first", "typed", "receiver", "nested", "fresh", "native-order", "shadow", "comments-refuse", "foldkit-by-name", "foldkit-by-name-untried"}
