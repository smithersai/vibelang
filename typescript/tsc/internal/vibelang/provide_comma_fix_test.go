package vibelang

import (
	"strings"
	"testing"
)

func TestFixProvideCommaLineBreak(t *testing.T) {
	for _, trivia := range []string{"\n  ", " /* separator\n comment */ "} {
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
