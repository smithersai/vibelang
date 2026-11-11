package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const isMatcherBlockBoundaryQuote = "A line break after a completed `is` expression permits automatic semicolon insertion, so a following block is a separate statement."
const isMatcherFieldListQuote = "A brace field list on the matcher's line is the retired form and reports `EK0707`; write `Foo and { … }` to test a class and its properties."

func TestIsMatcherBlockBoundaryQuoted(t *testing.T) {
	for _, quote := range []string{isMatcherBlockBoundaryQuote, isMatcherFieldListQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("004-match.md no longer says %q", quote)
		}
	}
}

var isMatcherBlockTrivia = []struct {
	key, text string
	separate  bool
}{
	{"lf", "\n", true},
	{"crlf", "\r\n", true},
	{"cr", "\r", true},
	{"line-separator", "\u2028", true},
	{"paragraph-separator", "\u2029", true},
	{"line-comment", " // boundary\n", true},
	{"block-comment-lf", " /* boundary\n */ ", true},
	{"block-comment-unicode", " /* boundary\u2028 */ ", true},
	{"spaces", " ", false},
	{"block-comment", " /* same line */ ", false},
	{"semicolon", "; ", true},
}

func FuzzIsMatcherBlockBoundary(f *testing.F) {
	startShortBudget(f)
	for _, trivia := range isMatcherBlockTrivia {
		for home := uint8(0); home < 2; home++ {
			f.Add(trivia.key, home, home, home)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, matcher, home, effect uint8) {
		TestIsMatcherBlockBoundaryQuoted(t)
		index := 0
		if key != "" {
			index = int(key[0]) % len(isMatcherBlockTrivia)
		}
		for i, trivia := range isMatcherBlockTrivia {
			if key == trivia.key {
				index = i
				break
			}
		}
		trivia := isMatcherBlockTrivia[index]
		name := []string{"Foo", "classes.Foo", "NotFound", "Number", "predicate"}[matcher%5]
		body := "const ok = x is " + name + trivia.text + "{}; return ok"
		switch home % 4 {
		case 1:
			body = "x is " + name + trivia.text + "{}; return true"
		case 2:
			body = "let ok = false; ok = x is " + name + trivia.text + "{}; return ok"
		case 3:
			body = "return x is " + name + trivia.text + "{}"
		}
		modifier := ""
		if effect%2 != 0 {
			modifier = "effect "
		}
		source := "class Foo { a = 1 }; const classes = { Foo }; error NotFound {}\n" +
			"function predicate(x: unknown): boolean { return true }\n" +
			"export " + modifier + "function probe(x: unknown) { " + body + " }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := false
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 707 {
				got = true
			} else if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzIsMatcherBlockBoundary", fmt.Sprintf("%s/%s/home%d/effect%d", trivia.key, name, home%4, effect%2), "unexpected diagnostic: %s\n%s", d.String(), source)
			}
		}
		if got == trivia.separate {
			Gap(t, "FuzzIsMatcherBlockBoundary", fmt.Sprintf("%s/%s/home%d/effect%d", trivia.key, name, home%4, effect%2), "%s %s; want EK0707=%t, got %t\n%s", isMatcherBlockBoundaryQuote, isMatcherFieldListQuote, !trivia.separate, got, source)
		}
	})
}
