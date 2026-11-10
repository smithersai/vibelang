package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const grammarDataSeparatorQuote = `DataDeclaration = DataStart TypeParameters? "{" (Variant (Separator Variant)* Separator?)? "}"`

func TestGrammarAdmissionDataSeparatorsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarDataSeparatorQuote) {
		t.Fatal("Appendix A's variant separators changed; review the admission oracle")
	}
}

func TestGrammarAdmissionDataSeparatorsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"data D { ; A }",
		"data D { A; ; B }",
		"data D { A;; }",
		"data D { ; }",
		"data D { A, ; B }",
		"data D { A { x: number }; /* gap */ ; B }",
	} {
		t.Run(source, func(t *testing.T) {
			if got := grammarAdmissionForm(source); got != "admission:data-separators" {
				t.Fatalf("key=%q, want admission:data-separators", got)
			}
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("standalone variant separator remains admitted: %v", r.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"data D {}",
		"data D { A; B; }",
		"data D { A, B, }",
		"data D { A\nB }",
		"data D { A { x: number; y: string } }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:data-separators" {
			t.Fatalf("valid control misclassified: %s", source)
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("valid variant separator control became a gap: %s", source)
		}
	}
}
