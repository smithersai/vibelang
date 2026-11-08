package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

// The rewrite writes a global chapter 5 allows; the rule it must not break is
// the EK4402 row's own: it must "preserve run phase, captures, receiver and
// public types".
const platformBufferAllowedQuote = "web data utilities with no I/O (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`"
const platformBufferPreservesQuote = "if the move cannot preserve run phase, captures, receiver and public types"

var platformBufferFixKeys = []string{"call", "utf8", "dashed", "nested", "bytes", "hex", "union"}

func TestPlatformBufferFixQuoted(t *testing.T) { platformBufferFixQuoted(t) }
func platformBufferFixQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{platformBufferAllowedQuote, platformBufferPreservesQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}

// platformBufferUTF8Length is what Buffer.byteLength documents for a string of
// these UTF-16 code units: a lone surrogate counts as U+FFFD's three bytes.
func platformBufferUTF8Length(units []uint16) int {
	total := 0
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch {
		case u < 0x80:
			total++
		case u < 0x800:
			total += 2
		case u >= 0xD800 && u < 0xDC00 && i+1 < len(units) && units[i+1] >= 0xDC00 && units[i+1] < 0xE000:
			total += 4
			i++
		default:
			total += 3
		}
	}
	return total
}
