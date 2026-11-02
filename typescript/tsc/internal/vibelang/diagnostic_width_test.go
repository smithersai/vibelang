package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestWideDiagnosticLists(t *testing.T) {
	t.Run("EK4701", func(t *testing.T) {
		var source strings.Builder
		source.WriteString("data Wide { ")
		for i := 0; i < 301; i++ {
			fmt.Fprintf(&source, "Case%03d; ", i)
		}
		source.WriteString("}\nexport function f(x: Wide) { return match (x) { when Wide.Case000: 0; } }")
		program, file, _, _ := editorProgram(t, source.String())
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() != 4701 {
				continue
			}
			found = true
			text := diagnosticWithNotes(d)
			if !strings.Contains(text, "(290 more)") || strings.Contains(text, "Wide.Case011") {
				t.Fatalf("unbounded match diagnostic (%d chars): %.500s", len(text), text)
			}
		}
		if !found {
			t.Fatal("missing EK4701")
		}
	})
	t.Run("EK3205", func(t *testing.T) {
		var source strings.Builder
		for i := 0; i < 300; i++ {
			fmt.Fprintf(&source, "service Need%03d { value: number }\n", i)
		}
		source.WriteString("export function main() { ")
		for i := 0; i < 300; i++ {
			fmt.Fprintf(&source, "Need%03d(); ", i)
		}
		source.WriteString("}")
		program, file, _, _ := editorProgram(t, source.String())
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() != 3205 {
				continue
			}
			found = true
			text := diagnosticWithNotes(d)
			if !strings.Contains(text, "(290 more)") || strings.Contains(text, "Need010") {
				t.Fatalf("unbounded entry diagnostic (%d chars): %.500s", len(text), text)
			}
		}
		if !found {
			t.Fatal("missing EK3205")
		}
	})
}
