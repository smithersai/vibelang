package vibelangfuzz

import (
	"strings"
	"testing"
)

const grammarThrowCommaQuote = "The invalid-punctuator lookahead also applies to comma separators."

func TestGrammarAdmissionThrowCommaQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarThrowCommaQuote) {
		t.Fatalf("Appendix A's VIP-41 comma migration rule changed: %s", grammarThrowCommaQuote)
	}
}

// Comma separators reject a bare throw; grouping the whole throw preserves
// the admitted form. Operators and throw statements retain their own rules.
func TestGrammarAdmissionThrowCommaWarning(t *testing.T) {
	for _, c := range []struct {
		name, source string
		mismatch     bool
	}{
		{"array-element", "effect function f(e) { return [throw e, 1]; }", false},
		{"call-argument", "effect function f(e, g) { return g(throw e, 1); }", false},
		{"object-property", "effect function f(e) { return { a: throw e, b: 1 }; }", false},
		{"member-operand", "effect function f(e) { return [throw e.cause, 1]; }", false},
		{"join-operand", "effect function f ( e ) { return [ join throw e , 1 ] ; }", false},
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
		})
	}
	for _, source := range []string{
		"const a = [1, 2];",
		"function f(e) { throw e, 1; }",
		"effect function f(e) { return [(throw e), 1]; }",
		"effect function f(e) { return [throw (e, 1)]; }",
		"effect function f(e) { return [throw, 1]; }",
		"function f(c, e) { if (c) throw e, 1; }",
		"function f(c, e) { if (c) { } else throw e, 1; }",
		"function f(e) { { } throw e, 1; }",
		"function f(e) { f(e); throw e, 1; }",
	} {
		if grammarThrowCommaWarning(grammarLexSource(source)) {
			t.Errorf("throw-comma key for %q", source)
		}
	}
	// A throw after an operator or an operand-taking word is an expression.
	for _, source := range []string{
		"effect function f(e) { return [join throw e, 1]; }",
		"effect function f(e) { return [void throw e, 1]; }",
		"effect function f(a, e) { return [a + throw e, 1]; }",
		"effect function f(e) { return [!throw e, 1]; }",
	} {
		if !grammarThrowCommaWarning(grammarLexSource(source)) {
			t.Errorf("no throw-comma key for %q", source)
		}
	}
}
