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
// member. A schema field has no modifier at all, yet the compiler accepts one
// written with effect: that form stays a pending admission gap. A field named
// effect and a native readonly field are derived controls.
func TestGrammarAdmissionEffectMember(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source   string
		mismatch bool
	}{
		{"type T = { effect id : string }", false},
		{"interface I { effect id : string }", false},
		{"schema S { effect id : string }", true},
		{"schema S { effect id ?: string }", true},
		{"schema S = { effect id : string }", true},
		{"schema S { effect : string }", false},
		{"schema S { readonly id : string }", false},
		{"schema S { id : string }", false},
	} {
		t.Run(c.source, func(t *testing.T) {
			if got := grammarAdmissionVerdict(t, w, c.source); got != c.mismatch {
				t.Fatalf("mismatch=%v, want %v", got, c.mismatch)
			}
			if form := grammarAdmissionForm(c.source); c.mismatch != (form == "admission:schema-effect-field") {
				t.Fatalf("form %q for mismatch=%v", form, c.mismatch)
			}
		})
	}
	for _, source := range []string{
		"type T = { effect id : string }",
		"schema S { effect : string }",
		"schema S { a : { effect id : string } }",
		"const effect = 1; schema S { id : string }",
	} {
		if grammarSchemaEffectField(grammarLexSource(source)) {
			t.Errorf("schema-effect-field key for %q", source)
		}
	}
}
