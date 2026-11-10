package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// Appendix A permits one separator between variants and one final separator.
// A separator cannot itself stand where a variant name is required.
func TestDataVariantSeparatorGrammar(t *testing.T) {
	for _, row := range []struct {
		name, body string
		count      int
	}{
		{"leading-semicolon", "; A", 1},
		{"leading-comma", ", A", 1},
		{"double-semicolon", "A; ; B", 1},
		{"double-comma", "A, , B", 1},
		{"mixed-separators", "A, ; B", 1},
		{"repeated-final", "A;;", 1},
		{"only-semicolon", ";", 1},
		{"two-leading", "; ; A", 2},
		{"payload", "A { x: number }; ; B", 1},
		{"commented", "A; /* no variant */ ; B", 1},
		{"newline-repeated", "A;\n;\nB", 1},
		{"quoted-variant", "\"bad\"; B", 1},
		{"quoted-payload", "\"bad\" { x: number }; B", 1},
		{"quoted-repeated", "\"bad\"; ; B", 2},
		{"quoted-comma", "\"bad\", B", 1},
		{"quoted-mixed", "\"bad\", ; B", 2},
		{"empty-control", "", 0},
		{"semicolon-control", "A; B;", 0},
		{"comma-control", "A, B,", 0},
		{"linebreak-control", "A\nB", 0},
		{"payload-newline-control", "A\n{ x: number }\nB", 0},
		{"nested-type-control", "A { x: { a: number; b: string; } }; B", 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "data D { "+row.body+" }\nexport {}")
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() != "EK" || d.Code() != 1606 {
					t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.MessageText())
					continue
				}
				count++
			}
			if count != row.count {
				t.Fatalf("EK1606 count=%d want %d: %s", count, row.count, row.body)
			}
		})
	}
}
