package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const shorthandTriviaQuote = "There is no top-level shorthand"

var shorthandTriviaCases = []struct{ key, trivia string }{
	{"block-keyword", "/* function */ "},
	{"block-substring", "/* malfunction functionally */ "},
	{"line-keyword", "// function\n"},
	{"multiline-keyword", "/*\nfunction\n*/ "},
	{"two-comments", "/* function */ /* async */ "},
	{"ordinary-space", " "},
}

func TestEffectShorthandTriviaQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), shorthandTriviaQuote) {
		t.Fatalf("chapter 1 no longer says %q", shorthandTriviaQuote)
	}
}

func FuzzEffectShorthandTrivia(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), shorthandTriviaQuote) {
		f.Fatalf("missing quote: %s", shorthandTriviaQuote)
	}
	w := NewWorkspace(f)
	for _, c := range shorthandTriviaCases {
		for mode := range uint8(4) {
			f.Add(c.key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		c := shorthandTriviaCases[0]
		found := false
		for _, candidate := range shorthandTriviaCases {
			if candidate.key == key {
				c = candidate
				found = true
				break
			}
		}
		if !found && len(key) > 0 {
			c = shorthandTriviaCases[int(key[0])%len(shorthandTriviaCases)]
		}
		modifier := "effect"
		if mode&1 != 0 {
			modifier = "async"
		}
		keyword := ""
		if mode&2 != 0 {
			keyword = "function "
		}
		source := "export " + c.trivia + modifier + " " + keyword + "load<T>(value: T) { return value }\n"
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		// The chapter rejects the same declaration with or without trivia.
		// Compare diagnostic identity to the comment-free control. The separate
		// FuzzFunctionBoundaries target retains its exact EK0101 oracle and
		// existing core-owned pending entry for the legacy diagnostic number.
		reference := "export " + modifier + " " + keyword + "load<T>(value: T) { return value }\n"
		control, err := w.Compile(context.Background(), Single(reference))
		if err != nil {
			t.Fatal(err)
		}
		defer control.Remove()
		codes := func(r *Result) []string {
			var out []string
			for _, d := range r.Diagnostics {
				if d.Source() == "EK" && d.Category() == diagnostics.CategoryError {
					out = append(out, fmt.Sprintf("EK%04d", d.Code()))
				}
			}
			return out
		}
		actual, expected := codes(result), codes(control)
		if keyword != "" && (HasError(result.Diagnostics) || HasError(control.Diagnostics)) {
			Gap(t, "FuzzEffectShorthandTrivia", c.key+":native-control-error", "written function control rejected: %v / %v", Keys(result.Dir, result.Diagnostics), Keys(control.Dir, control.Diagnostics))
		}
		want := 1
		if keyword != "" {
			want = 0
		}
		gapKey := fmt.Sprintf("%s:mode%d", c.key, mode%4)
		if len(expected) != want || len(actual) != want || strings.Join(actual, ",") != strings.Join(expected, ",") {
			Gap(t, "FuzzEffectShorthandTrivia", gapKey, "%s; trivia and comment-free declarations require %d identical errors: got %v, control %v:\n%s", shorthandTriviaQuote, want, actual, expected, source)
		}
		ExpectPending(t, "FuzzEffectShorthandTrivia", gapKey)
	})
}

func TestEffectShorthandTriviaCorpus(t *testing.T) {
	for _, c := range shorthandTriviaCases {
		p := filepath.Join(repoTestdata(), "fuzz", "FuzzEffectShorthandTrivia", c.key)
		if _, err := os.Stat(p); err != nil {
			t.Fatal(err)
		}
	}
}
