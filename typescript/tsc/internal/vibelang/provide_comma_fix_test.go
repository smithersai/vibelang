package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestFixProvideCommaLineBreak(t *testing.T) {
	for _, trivia := range []string{"\n  ", " /* separator */\n "} {
		source := "export effect function f() { provide Layer.empty," + trivia + "Layer.empty {} }"
		program, file, _, _ := editorProgram(t, source)
		proposal := fileFixes(t.Context(), program, file, nil, []int32{EK1202.Code})
		want := strings.ReplaceAll(source, "\n", " ")
		if got := proposal.text(); got != want {
			t.Fatalf("got %q; want %q", got, want)
		}
	}
	source := "export effect function f() { provide Layer.empty, // keep this comment\n Layer.empty {} }"
	program, file, _, _ := editorProgram(t, source)
	proposal := fileFixes(t.Context(), program, file, nil, []int32{EK1202.Code})
	if got := proposal.text(); got != source {
		t.Fatalf("line comment changed: %q", got)
	}
}

// Chapter 7's comment-preservation promise forbids flattening line breaks
// inside a comment. Joining ordinary separator trivia remains safe.
func TestFixProvideCommaKeepsBlockComments(t *testing.T) {
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		for _, before := range []bool{false, true} {
			name := fmt.Sprintf("%q/before=%t", newline, before)
			t.Run(name, func(t *testing.T) {
				trivia := " /* separator" + newline + " comment */ "
				left, right := ",", ""
				if before {
					left, right = "", ","
				}
				source := "export effect function f() { provide Layer.empty" + left + trivia + right + "Layer.empty {} }"
				program, file, _, _ := editorProgram(t, source)
				proposal := fileFixes(t.Context(), program, file, nil, []int32{EK1202.Code})
				if got := proposal.text(); got != source {
					t.Fatalf("multiline comment changed: got %q; want %q", got, source)
				}
			})
		}
	}
}
