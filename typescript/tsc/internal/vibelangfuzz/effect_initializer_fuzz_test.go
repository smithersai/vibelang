package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const effectInitializerQuote = "Directly after `A!`, where the next `!` completes `A!!`, the scanner reads that `!` as one token and rescans from the next character, as TypeScript rescans `>` after type arguments:"

func TestEffectInitializerQuoted(t *testing.T) { requireEffectInitializerQuote(t) }
func requireEffectInitializerQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectInitializerQuote) {
		t.Fatalf("chapter 001 no longer contains %q", effectInitializerQuote)
	}
}

// Equality-token rescanning belongs only to the shorthand type boundary.
// Initializers with/without trivia agree; ordinary inequality stays native.
func FuzzEffectAdjacentInitializer(f *testing.F) {
	startShortBudget(f)
	requireEffectInitializerQuote(f)
	for _, key := range []string{"double-bang", "error", "requirements", "comparison"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(5))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		typ := "number!!"
		switch key {
		case "comparison", "double-bang":
		case "error":
			typ = "number!Error"
		case "requirements":
			typ = "number!!Context"
		default:
			key = "double-bang"
		}
		gap := []string{"", " ", "\t", "/* initializer */"}[mode%4]
		source := "const value: " + typ + gap + "= Effect.succeed(1)"
		if key == "comparison" {
			source = "const same = 1 !== 2; const different = 1 != 2"
		}
		if mode&4 != 0 {
			source = "function f() { " + source + " }"
		}
		if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
			Gap(t, "FuzzEffectAdjacentInitializer", "effect-adjacent-initializer:"+key, "%s; source rejected: %s\n%s", effectInitializerQuote, syntax, source)
		}
	})
}
