package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const grammarEffectTypeMemberQuote = "an `interface` or type literal member with that modifier is rejected with `EK0108`"

func TestGrammarAdmissionEffectMemberQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarEffectTypeMemberQuote) {
		t.Fatalf("Appendix A's EffectModifier rejection changed: %s", grammarEffectTypeMemberQuote)
	}
}

// grammarAdmissionVerdict is checkGrammarAdmission's verdict without the
// pending lookup: true when the compiler accepts a program Appendix A does
// not derive.
func grammarAdmissionVerdict(t *testing.T, w *Workspace, source string) bool {
	t.Helper()
	if mismatch, _ := grammarAdmissionMismatch(source); !mismatch {
		return false
	}
	result, err := w.Compile(context.Background(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	if result.Program != nil && HasError(result.Program.GetSyntacticDiagnostics(context.Background(), nil)) {
		return false
	}
	for _, d := range result.Diagnostics {
		if grammarAdmissionSyntaxDiagnostic(d) {
			return false
		}
	}
	return true
}

// EK0108 rejects a recognized effect modifier on an interface or type literal
// member. A schema field has no modifier at all: Appendix A gives a field
// written with effect no derivation, and the compiler rejects it too, so it
// is no admission gap. A field named effect and a native readonly field are
// derived controls.
func TestGrammarAdmissionEffectMember(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarSchemaFieldTypeQuote) {
		t.Fatalf("Appendix A Field changed: %s", grammarSchemaFieldTypeQuote)
	}
	w := NewWorkspace(t)
	for _, c := range []struct {
		source     string
		underived  bool
		unmodified bool
	}{
		{"type T = { effect id : string }", false, false},
		{"interface I { effect id : string }", false, false},
		{"schema S { effect id : string }", true, false},
		{"schema S { effect id ?: string }", true, false},
		{"schema S = { effect id : string }", true, false},
		{"schema S { readonly effect id : string }", false, false},
		{"schema S { a : { effect id : string } }", false, false},
		{"schema S = { effect id : string } | { other : number }", false, false},
		{"schema S = [ { effect id : string } ]", false, false},
		{"schema S { effect id : Missing }", false, false},
		{"schema S { effect : string }", false, true},
		{"schema S { readonly id : string }", false, true},
		{"schema S { id : string }", false, true},
	} {
		t.Run(c.source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, c.source) {
				t.Fatalf("the compiler accepts a program Appendix A does not derive: %s", c.source)
			}
			mismatch, detail := grammarAdmissionMismatch(c.source)
			if c.underived && !mismatch {
				t.Fatalf("the grammar lab derives a schema field with an effect modifier: %s", c.source)
			}
			if c.unmodified && mismatch {
				t.Fatalf("an ordinary field lost its derivation: %s: %s", c.source, detail)
			}
			if form := grammarAdmissionForm(c.source); form != "" {
				t.Fatalf("form %q for a program with no admission gap", form)
			}
		})
	}
}
