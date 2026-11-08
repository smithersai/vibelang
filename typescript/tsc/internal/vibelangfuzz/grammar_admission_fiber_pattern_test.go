package vibelangfuzz

import (
	"context"
	"testing"
)

// Appendix A reserves `fork` and `join` wherever an IdentifierReference could
// stand in Effect code. A `new` callee and a heritage expression now report
// EK1702 there; an is pattern's head is read by the pattern parser, which
// takes either word as a pattern identifier and leaves only checker errors
// such as EK4410, so the form is still accepted without a defining rule.
var grammarFiberPatternGaps = []string{
	"effect function f(p) { return p is join }",
	"effect function f(p) { return p is not fork }",
	"effect function f(s, p) { return fork.in(s) p is join }",
}

var grammarFiberPatternControls = []string{
	"function g(p) { return p is join }",
	"effect function f(p) { return p is x.join }",
	"effect function f(p) { return p is let join }",
}

func TestGrammarAdmissionFiberPatternKeys(t *testing.T) {
	for _, source := range grammarFiberPatternGaps {
		if got := grammarAdmissionForm(source); got != "admission:fiber-pattern-reference" {
			t.Errorf("key=%q, want admission:fiber-pattern-reference: %q", got, source)
		}
	}
	for _, source := range grammarFiberPatternControls {
		if got := grammarAdmissionForm(source); got == "admission:fiber-pattern-reference" {
			t.Errorf("control keyed as a reserved pattern head: %q", source)
		}
	}
}

func TestGrammarAdmissionFiberPatternRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarFiberPatternGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// Plain code keeps ordinary identifiers; a member name is never reserved;
	// a pattern binding is the fiber-binding family.
	for _, source := range grammarFiberPatternControls[:2] {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("control became an admission gap: %q", source)
			}
		})
	}
}
