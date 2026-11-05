package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const grammarJoinHeadQuote = "ForkOperand = UnaryExpression   (await's operand, as for try; VIP-17, amended: \"exactly as await\")"

func TestGrammarAdmissionJoinForHeadQuoted(t *testing.T) {
	for _, quote := range []string{grammarAdmissionQuote, grammarJoinHeadQuote} {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatalf("Appendix A join target authority changed: %s", quote)
		}
	}
}

// VIP-17's join expression follows await's grammar. The native for-of target
// error must survive an independent join operand type error.
func TestGrammarAdmissionJoinForHead(t *testing.T) {
	TestGrammarAdmissionJoinForHeadQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"effect function f(xs) { for (join x of xs) { x; } }",
		"effect function f(xs) { for (join\nx\nof xs) { x; } }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				seen = seen || d.Source() == "" && d.Code() == 2487 && d.Category() == diagnostics.CategoryError && grammarAdmissionSyntaxDiagnostic(d)
			}
			if !seen {
				t.Fatalf("invalid join for-of target lost native TS2487: %v", result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("rejected join target became an admission mismatch")
			}
		})
	}
}
