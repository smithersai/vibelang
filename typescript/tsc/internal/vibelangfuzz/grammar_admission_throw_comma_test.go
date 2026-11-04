package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const grammarThrowCommaQuote = "Its new punctuator-only comma case temporarily reports warning `EK1010` until the parenthesizing `vibelang --fix` ships"

func TestGrammarAdmissionThrowCommaQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarThrowCommaQuote) {
		t.Fatalf("Appendix A's VIP-41 comma migration rule changed: %s", grammarThrowCommaQuote)
	}
}

// A parse warning is not a syntax rejection. The deferred comma case compiles
// with only the warning EK1010, and Appendix A has no derivation for it, so
// the oracle reports it under its pending key. Parenthesized throws, the
// operator-left errors and a ThrowStatement's comma expression are controls.
func TestGrammarAdmissionThrowCommaWarning(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		name, source string
		mismatch     bool
	}{
		{"array-element", "effect function f(e) { return [throw e, 1]; }", true},
		{"call-argument", "effect function f(e, g) { return g(throw e, 1); }", true},
		{"object-property", "effect function f(e) { return { a: throw e, b: 1 }; }", true},
		{"member-operand", "effect function f(e) { return [throw e.cause, 1]; }", true},
		{"parenthesized-throw", "effect function f(e) { return [(throw e), 1]; }", false},
		{"parenthesized-operand", "effect function f(e) { return [throw (e, 1)]; }", false},
		{"operator-left", "effect function f(e) { return [throw e + 1, 1]; }", false},
		{"throw-statement", "function f(e) { throw e, 1; }", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, detail := grammarAdmissionMismatch(c.source)
			if got != c.mismatch {
				t.Fatalf("mismatch=%v (%s), want %v", got, detail, c.mismatch)
			}
			form := grammarAdmissionForm(c.source)
			if c.mismatch != (form == "admission:throw-comma-warning") {
				t.Fatalf("form %q for mismatch=%v", form, c.mismatch)
			}
			if !c.mismatch {
				return
			}
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			var all []*ast.Diagnostic
			if result.Program != nil {
				all = append(all, result.Program.GetSyntacticDiagnostics(context.Background(), nil)...)
			}
			all = append(all, result.Diagnostics...)
			warned := false
			var seen []string
			for _, d := range all {
				seen = append(seen, fmt.Sprintf("%s%d[%v]", d.Source(), d.Code(), d.Category()))
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("syntax rejection %s%d; the deferred comma case must only warn", d.Source(), d.Code())
				}
				warned = warned || IsEK(d) && d.Code() == 1010 && d.Category() == diagnostics.CategoryWarning
			}
			if !warned {
				t.Fatalf("no EK1010 warning: %s", strings.Join(seen, ", "))
			}
		})
	}
	for _, source := range []string{
		"const a = [1, 2];",
		"function f(e) { throw e, 1; }",
		"effect function f(e) { return [(throw e), 1]; }",
		"effect function f(e) { return [throw (e, 1)]; }",
		"effect function f(e) { return [throw, 1]; }",
	} {
		if grammarThrowCommaWarning(grammarLexSource(source)) {
			t.Errorf("throw-comma key for %q", source)
		}
	}
}
