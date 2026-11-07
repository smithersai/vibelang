package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGrammarAdmissionAccessorQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed")
	}
}

func TestGrammarAdmissionAccessorDiagnostics(t *testing.T) {
	for _, code := range []int32{1049, 1051, 1052, 1053, 1054, 1094, 1095, 2784} {
		for _, source := range []string{"", "EK", "other"} {
			for _, category := range []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage} {
				d := ast.NewExternalDiagnostic(nil, core.TextRange{}, source, category, code, "accessor")
				want := source == "" && category == diagnostics.CategoryError
				if got := grammarAdmissionSyntaxDiagnostic(d); got != want {
					t.Errorf("source=%q category=%v code=%d: syntax=%v, want %v", source, category, code, got, want)
				}
			}
		}
	}
}

func TestGrammarAdmissionAccessorRegression(t *testing.T) {
	TestGrammarAdmissionAccessorQuoted(t)
	w := NewWorkspace(t)
	for _, tc := range []struct {
		source string
		code   int32
	}{
		{"type T = { get size(x: number): number }", 1054},
		{"type T = { set size() }", 1049},
		{"type T = { set size(x: number, y: number) }", 1049},
		{"type T = { set size(x?: number) }", 1051},
		{"type T = { set size(x = 1) }", 1052},
		{"type T = { set size(...x: number[]) }", 1053},
		{"type T = { get size<A>(): A }", 1094},
		{"type T = { set size(x: number): number }", 1095},
		{"type T = { get size(this: T): number }", 2784},
		{"type T = { set size(this: T, value: number) }", 2784},
	} {
		t.Run(tc.source, func(t *testing.T) {
			r, err := w.Compile(context.Background(), Single(tc.source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range r.Diagnostics {
				if d.Source() == "" && d.Code() == tc.code {
					seen = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Errorf("TS%d must reject syntax", tc.code)
					}
				}
			}
			if !seen {
				t.Fatalf("missing TS%d: %v", tc.code, r.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, tc.source) {
				t.Fatal("native accessor rejection became an admission gap")
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(tc.source), tc.source)
		})
	}
}
