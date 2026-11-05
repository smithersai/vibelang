package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const preludeEffectValueQuote = "The non-function value exports are globals too"

func TestPreludeEffectValueQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), preludeEffectValueQuote) {
		t.Fatal("Effect value globals quote changed")
	}
}

func FuzzPreludeEffectValue(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"bare", "qualified", "match", "block"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestPreludeEffectValueQuoted(t)
		operand := "yieldNow"
		if key == "qualified" {
			operand = "Effect.yieldNow"
		}
		if mode%2 == 1 {
			operand = "(" + operand + ")"
		}
		body := "try " + operand + "; return 7"
		switch key {
		case "match":
			body = "return match (input) { when 0: 0; when 1: do { try " + operand + "; 7 }; default: -1; }"
		case "block":
			body = "return try (effect { try " + operand + "; return 7 })"
		case "qualified":
		default:
			key = "bare"
		}
		source := "import { Effect } from 'effect'; export effect function probe(input: number = 1): number!! { " + body + " }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		if len(got) > 0 {
			Gap(t, "FuzzPreludeEffectValue", fmt.Sprintf("%s/%d", key, mode%2), "Effect value exports run directly: %v", got)
		}
	})
}
