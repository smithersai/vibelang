package vibelangmapper

import (
	"strings"
	"testing"
)

// A regex pattern with an extractor reaches the projector with `(let` as a
// parenthesized expression that has no closing parenthesis. It read as both a
// source node and a holder of an is pattern, so visit and synthesized called
// each other until the goroutine's stack overflowed, which no recover catches:
// one case in the corpus stopped every test in this package.
func TestUnclosedParenthesisProjectionTerminates(t *testing.T) {
	spellings := []string{"(let m)", "( let m )", "(let\n m)", "(/* c */ let m)", "(let m", "(let [a, b])", "(let { a })"}
	for _, forms := range []string{
		`export const a = (s: string) => s is /(\d+)/%s`,
		`export const a = (s: string) => match (s) { when /(\d+)/%s: 1; default: 2; }`,
		`export const a = "12" is /\d+/%s`,
	} {
		for _, spelling := range spellings {
			source := strings.Replace(forms, "%s", spelling, 1)
			t.Run(source, func(t *testing.T) {
				if result := Project(source, testContext); !strings.Contains(result.Text, "/") {
					t.Fatalf("the projection lost the regex: %q", result.Text)
				}
			})
		}
	}
}

// A holder still projects: `(x as T) is [let a]` starts with its subject's own
// parenthesis and spans its pattern.
func TestIsHolderStartingWithParenthesisStillProjects(t *testing.T) {
	result := Project(`export const f = (x: unknown) => (x as number[]) is [let a] ? a : 0`, testContext)
	if !strings.Contains(result.Text, "x as number[]") {
		t.Fatalf("the subject was lost: %q", result.Text)
	}
}
