package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const catchMissingArrowQuote = "For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression."

func TestCatchMissingArrowQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), catchMissingArrowQuote) {
		t.Fatal("VIP-5 missing-arrow recovery quote changed")
	}
}

// Keyed heads and fuzzed trivia, grouping and try prefixes exercise the
// recovery boundary. The repaired literal is a separate positive control.
func FuzzCatchMissingArrow(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), catchMissingArrowQuote) {
		f.Fatal("VIP-5 missing-arrow recovery quote changed")
	}
	heads := []string{"plain", "effect", "typed", "generic", "empty", "async"}
	for _, key := range heads {
		f.Add(key, uint8(0))
	}
	f.Add("plain", uint8(2))
	f.Add("plain", uint8(3))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		head := "(e)"
		switch key {
		case "effect":
			head = "effect (e)"
		case "typed":
			head = "(e: string)"
		case "generic":
			head = "<E extends string>(e: E)"
		case "empty":
			head = "()"
		case "async":
			head = "async (e)"
		default:
			key = "plain"
		}
		trivia := []string{" ", " /* arrow */ ", "\n", "\r\n"}[mutation%4]
		prefix := ""
		if mutation&4 != 0 {
			prefix = "try "
		}
		grouping := mutation&8 != 0
		check := func(arrow string, want int32) {
			handler := head + trivia + arrow + "{ return 0 }"
			if arrow != "" {
				// Native arrows forbid a line break before =>. Keep the mutated
				// trivia after the arrow when constructing the admitted control.
				handler = head + " " + arrow + trivia + "{ return 0 }"
			}
			if grouping {
				handler = "(" + handler + ")"
			}
			source := "import { Effect } from \"effect\"; export effect function f() { return " + prefix + "Effect.fail(\"bad\") catch " + handler + " }"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []string
			found := false
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, fmt.Sprintf("%s%d", d.Source(), d.Code()))
					if IsEK(d) && d.Code() == want {
						found = true
					}
				}
			}
			if want == 0 && len(codes) != 0 || want != 0 && (!found || len(codes) != 1) {
				Gap(t, "FuzzCatchMissingArrow", key, "%s: want only EK%04d (zero means no errors), got %v\n%s", catchMissingArrowQuote, want, codes, source)
			}
		}
		check("", 509)
		// Async is independently forbidden and try+catch is a separate rule.
		if key != "async" && prefix == "" {
			check("=> ", 0)
		}
	})
}
