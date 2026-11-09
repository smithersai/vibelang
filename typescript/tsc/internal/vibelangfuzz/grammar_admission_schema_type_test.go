package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// Appendix B distinguishes the schema mapping's type/value restrictions from
// the grammar's Field production. A missing schema value cannot excuse an
// unrelated modifier that Appendix A does not admit: a field written with
// effect reports EK0108 beside EK2109, so it is no admission gap.
const grammarSchemaTypeQuote = "a `schema` field type outside the mapping"
const grammarSchemaReferenceQuote = "A reference with no suitable Schema value is `EK2109`: declare a schema or name a Schema value."

func TestGrammarAdmissionSchemaTypeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), grammarSchemaReferenceQuote) {
		t.Fatalf("Chapter 006's schema reference rule changed: %s", grammarSchemaReferenceQuote)
	}

	if !strings.Contains(SpecText(grammarAppendix), grammarSchemaTypeQuote) {
		t.Fatalf("Appendix B's schema type diagnostic changed: %s", grammarSchemaTypeQuote)
	}
}

func TestGrammarAdmissionSchemaTypeDiagnostic(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		name, source string
		mismatch     bool
	}{
		{"ordinary-field", "schema S { id: Missing }", false},
		{"optional-field", "schema S { id?: Missing }", false},
		{"readonly-field", "schema S { readonly id: Missing }", false},
		{"effect-field", "schema S { effect id: Missing }", false},
		{"optional-effect-field", "schema S { effect id?: Missing }", false},
		{"alias-effect-field", "schema S = { effect id: Missing }", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				if IsEK(d) && d.Code() == 2109 {
					seen = true
					if grammarAdmissionSyntaxDiagnostic(d) {
						t.Errorf("EK2109 is a schema type/value error, not syntax rejection: %s", d.String())
					}
				}
			}
			if !seen {
				t.Fatal("control did not exercise EK2109")
			}
			if got := grammarAdmissionVerdict(t, w, c.source); got != c.mismatch {
				t.Fatalf("mismatch=%v, want %v: %s", got, c.mismatch, c.source)
			}
		})
	}
}
