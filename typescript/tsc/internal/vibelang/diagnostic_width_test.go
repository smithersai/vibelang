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
		source.WriteString("}\nexport function f(x: Wide) { return match (x) { when { _tag: \"Case000\" }: 0; } }")
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
		// EK3205 belongs to the explicitly marked legacy entry migration.
		const marker = "import \"vibelang/platform/node\"\n"
		source.WriteString(marker)
		for i := 0; i < 300; i++ {
			fmt.Fprintf(&source, "service Need%03d { value: number }\n", i)
		}
		source.WriteString("export effect function main() { ")
		for i := 0; i < 300; i++ {
			fmt.Fprintf(&source, "try Need%03d; ", i)
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
			t.Fatalf("missing EK3205: %v", program.GetSemanticDiagnostics(t.Context(), file))
		}
		// The same requirements in ordinary source do not select implicit startup.
		ordinary, ordinaryFile, _, _ := editorProgram(t, strings.TrimPrefix(source.String(), marker))
		for _, d := range ordinary.GetSemanticDiagnostics(t.Context(), ordinaryFile) {
			if d.Code() == 3205 {
				t.Fatal("unmarked main selected a legacy entry diagnostic")
			}
		}
	})
}
