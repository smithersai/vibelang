package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const taggedDataPatternQuote = "For each property retain key evaluation, presence check, cached value read, sub-pattern and binding initialization in order"

func TestTaggedDataPatternQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), taggedDataPatternQuote) {
		t.Fatal("object pattern rule changed")
	}
}

func FuzzTaggedDataPattern(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"match", "is"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestTaggedDataPatternQuoted(t)
		field := []string{"value", "text"}[mode%2]
		body := "return match(s) { when {_tag: \"Waiting\"}: \"waiting\"; when {_tag: \"Sent\", let " + field + "}: " + field + "; }"
		if key == "is" {
			body = "return s is {_tag: \"Sent\"}"
		} else {
			key = "match"
		}
		source := "data Delivery { Waiting; Sent { " + field + ": string } }; export function probe(s: Delivery) { " + body + " }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		if len(got) > 0 {
			Gap(t, "FuzzTaggedDataPattern", fmt.Sprintf("%s/%d", key, mode%2), "native data unions admit structural object patterns: %v", got)
		}
	})
}
