package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const objectFallbackQuote = "Its syntax decides its kind: `x catch (e) => v` (also function expressions) is plain, and its result is the fallback value; `x catch effect (e) => …` runs an Effect and may fail again."

func TestCatchObjectFallbackQuoted(t *testing.T) { checkCatchObjectFallbackQuote(t) }

func checkCatchObjectFallbackQuote(t testing.TB) {
	data, err := os.ReadFile(SpecPath("../vips/0005-try-runs-effects.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), objectFallbackQuote) {
		t.Fatal("VIP-5 handler-kind quote changed")
	}
}
