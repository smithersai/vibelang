package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGrammarAdmissionForOfAsyncQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A native for-of grammar authority changed")
	}
}

func TestGrammarAdmissionForOfAsyncName(t *testing.T) {
	TestGrammarAdmissionForOfAsyncQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"async\nfunction f ( xs ) { for ( async of xs ) effect { } }",
		"function f(xs) { for (async of xs) ; }",
		"function f(xs) { for (async of xs) {} }",
		"function f(xs) { for\n(async\nof xs) {} }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			rejected := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && d.Code() == 1106 && d.Category() == diagnostics.CategoryError {
					rejected = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Error("native TS1106 for-of error must count as syntax rejection")
					}
				}
			}
			if !rejected {
				t.Fatalf("for-of witness lost native TS1106: %v", result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("native for-of rejection became an admission mismatch")
			}
		})
	}
	for _, source := range []string{
		"let async; for (async in xs) {}",
		"for (const async of xs) {}",
		"for (obj.async of xs) {}",
		"for ((async) of xs) {}",
	} {
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range result.Diagnostics {
			if grammarAdmissionSyntaxDiagnostic(d) {
				t.Errorf("ordinary native head gained syntax rejection: %v", d)
			}
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("ordinary native head became an admission mismatch: %s", source)
		}
	}
}
