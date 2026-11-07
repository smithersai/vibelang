package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const grammarErrorStaticQuote = "no user-written `static` members or setters"

func TestGrammarAdmissionErrorStaticQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0013-error-declarations.md"), grammarErrorStaticQuote) {
		t.Fatal("VIP-13 static member rejection changed")
	}
}

func TestGrammarAdmissionErrorStaticDiagnostics(t *testing.T) {
	for _, source := range []string{"", "EK", "other"} {
		for _, category := range []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage} {
			d := ast.NewExternalDiagnostic(nil, core.TextRange{}, source, category, 1302, "static error member")
			want := source == "EK" && category == diagnostics.CategoryError
			if got := grammarAdmissionSyntaxDiagnostic(d); got != want {
				t.Errorf("source=%q category=%v: syntax=%v, want %v", source, category, got, want)
			}
		}
	}
}

func TestGrammarAdmissionErrorStaticRegression(t *testing.T) {
	TestGrammarAdmissionErrorStaticQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema error S { static async async\nid: Missing }",
		"error S { static async async\nid: Missing }",
		"schema error S { static id: Missing }",
	} {
		t.Run(source, func(t *testing.T) {
			r, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range r.Diagnostics {
				if IsEK(d) && d.Code() == 1302 {
					seen = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Error("EK1302 must reject syntax")
					}
				}
			}
			if !seen {
				t.Fatalf("missing EK1302: %v", r.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("rejected static error member became an admission gap")
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
