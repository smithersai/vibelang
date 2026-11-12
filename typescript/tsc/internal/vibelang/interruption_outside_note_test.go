package vibelang

import (
	"strings"
	"testing"
)

// Chapter 002, interruption blocks: EK2201's note gives both ways out, mask in
// effect code or keep a plain block, and refers to no earlier compiler, which
// a newcomer never used.
func TestInterruptionOutsideEffectNote(t *testing.T) {
	for _, word := range []string{"uninterruptible", "interruptible", "restore"} {
		t.Run(word, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export function load() { "+word+" { } }")
			var text string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK2201.Code {
					text = diagnosticWithNotes(d)
				}
			}
			want := "Use an effect function or effect block for masking. To keep the block without masking, remove only this keyword."
			if !strings.Contains(text, want) {
				t.Fatalf("EK2201 %q lacks the note %q", text, want)
			}
			if strings.Contains(text, "old compiler") {
				t.Fatalf("EK2201 refers to an earlier compiler: %q", text)
			}
		})
	}
}
