package vibelangfuzz

import (
	"context"
	"testing"
)

// Appendix A's ErrorStart is `error` [no LineTerminator here] BindingIdentifier,
// with no modifier before the word. The parser reads `abstract error Root {}`
// as an error declaration with an abstract modifier and reports only the
// interim EK1308 warning, so the form is accepted without a defining rule.
var grammarAbstractErrorGaps = []string{
	"abstract error Root {}",
	"export abstract error Root { value: string }",
	"abstract error Root {}\nerror Child extends Root {}",
}

var grammarAbstractErrorControls = []string{
	"error Root {}",
	"abstract class Root {}",
	"const abstract = 1; const error = abstract;",
}

func TestGrammarAdmissionAbstractErrorKeys(t *testing.T) {
	for _, source := range grammarAbstractErrorGaps {
		if got := grammarAdmissionForm(source); got != "admission:abstract-error" {
			t.Errorf("key=%q, want admission:abstract-error: %q", got, source)
		}
	}
	for _, source := range grammarAbstractErrorControls {
		if got := grammarAdmissionForm(source); got == "admission:abstract-error" {
			t.Errorf("control keyed as an abstract error: %q", source)
		}
	}
}

func TestGrammarAdmissionAbstractErrorRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarAbstractErrorGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range grammarAbstractErrorControls {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("control became an admission gap: %q", source)
			}
		})
	}
}
