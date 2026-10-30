package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const effectHeritageQuote = "Anywhere else, `effect` is an ordinary identifier, so `Layer.effect(…)` and `const effect = …` keep working."

func TestEffectHeritageQuoted(t *testing.T) { requireEffectHeritageQuote(t) }
func requireEffectHeritageQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectHeritageQuote) {
		t.Fatalf("chapter 001 no longer contains %q", effectHeritageQuote)
	}
}

// Class bodies must not become effect blocks when the base is named effect.
// Wrapped bases and effect blocks inside the extends expression are controls.
func FuzzEffectHeritageBody(f *testing.F) {
	startShortBudget(f)
	requireEffectHeritageQuote(f)
	for _, key := range []string{"declaration", "expression", "escaped", "wrapped", "nested"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		gap := []string{"", " ", "\n", " /* class body */ "}[mode%4]
		body := []string{"", "value = 7;", "effect read() { return 1 }", "program = effect { return 1 };"}[(mode/4)%4]
		base := "effect"
		switch key {
		case "escaped":
			base = "\\u0065ffect"
		case "wrapped":
			base = "(effect)"
		case "nested":
			base = "choose(effect { return 1 })"
		}
		source := "class C extends " + base + gap + "{" + body + "}"
		if key == "expression" {
			source = "const C = class extends " + base + gap + "{" + body + "}"
		}
		if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
			Gap(t, "FuzzEffectHeritageBody", "effect-heritage:"+key, "%s; class body rejected: %s\n%s", effectHeritageQuote, syntax, source)
		}
	})
}
