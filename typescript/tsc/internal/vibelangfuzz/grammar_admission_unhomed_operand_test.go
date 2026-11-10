package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// The rest pattern is valid. Its unhomed binding hides the invalid
// outside-Effect fiber prefix in the subject along with the subject itself.
const grammarUnhomedOperandWitness = "function g ( a = join xs is [ let first , ... 1 ] ) { }"

func TestGrammarAdmissionUnhomedOperandQuoted(t *testing.T) {
	for _, quote := range []string{
		`ForkExpression = [+Effect] "fork" ForkOperand`,
		`JoinExpression = [+Effect] "join" ForkOperand`,
		grammarAdmissionPlainBodyQuote,
	} {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatalf("Appendix A source-context production changed: %q", quote)
		}
	}
}

func grammarUnhomedOperandSources() []string {
	var sources []string
	for _, prefix := range []string{"join ", "fork "} {
		for _, pattern := range []string{"[let first, ...1]", "[let first]", "{a: let first}"} {
			sources = append(sources,
				"function g(a = "+prefix+"xs is "+pattern+") {}",
				"enum E { A = "+prefix+"xs is "+pattern+" }",
			)
		}
	}
	return sources
}

var grammarUnhomedOperandControls = []string{
	"function g(a = xs is [let first, ...1]) {}",
	"function g(a = typeof xs is [let first, ...1]) {}",
	"function g(a = void xs is [let first]) {}",
	"function g(a = join(xs) is [let first]) {}",
	"function g(a = fork(xs) is [let first]) {}",
	"const b = join xs is [let first, ...1];",
	"const b = fork xs is [let first];",
	"if (join xs is [let first]) {}",
	"effect function g() { const b = join xs is [let first]; }",
	"const s = 'function g(a = join xs is [let first]) {}';",
	"$patternError(4703); join xs;",
}

func TestGrammarAdmissionUnhomedOperandKeys(t *testing.T) {
	for _, source := range append(grammarUnhomedOperandSources(), grammarUnhomedOperandWitness) {
		if got := grammarAdmissionForm(source); got != "admission:unhomed-pattern-subject" {
			t.Errorf("key=%q, want admission:unhomed-pattern-subject: %q", got, source)
		}
	}
	for _, source := range grammarUnhomedOperandControls {
		if got := grammarAdmissionForm(source); got == "admission:unhomed-pattern-subject" {
			t.Errorf("control grouped as lost subject syntax: %q", source)
		}
	}
}

func TestGrammarAdmissionUnhomedOperandRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range append(grammarUnhomedOperandSources(), grammarUnhomedOperandWitness) {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes lost syntax: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
