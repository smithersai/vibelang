package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Appendix A gives for concurrent the body every loop has: a Statement,
// which has no lexical declaration.
const grammarForConcurrentBodyQuote = `ForConcurrent = [+Effect] "for" "concurrent" ("(" AssignmentExpression ")")? "(" ForDeclaration "of" AssignmentExpression ")" Statement`

func TestGrammarAdmissionForConcurrentBodyQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarForConcurrentBodyQuote) {
		t.Fatal("Appendix A's ForConcurrent production changed; review the loop body oracle")
	}
}

// TestGrammarAdmissionForConcurrentBody compares the compiler with itself on
// loops the grammar gives the same body. TypeScript parses a lexical
// declaration as a loop body for recovery and rejects it with TS1156; the
// grammar lab derives that recovery, so the admission oracle cannot see a
// loop that loses the rejection. A native for-of sets the expectation for
// each body, and for try and for concurrent must meet it.
func TestGrammarAdmissionForConcurrentBody(t *testing.T) {
	w := NewWorkspace(t)
	rejects := func(source string) (bool, string) {
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		var observed []string
		for _, d := range result.Diagnostics {
			observed = append(observed, fmt.Sprintf("%s%d", d.Source(), d.Code()))
			if d.Source() == "" && d.Code() == 1156 && d.Category() == diagnostics.CategoryError {
				found = true
			}
		}
		return found, strings.Join(observed, ", ")
	}
	const key = "admission:for-concurrent-declaration-body"
	for _, body := range []struct {
		name, text  string
		declaration bool
	}{
		{"const", "const y = 1;", true},
		{"let", "let y = 1;", true},
		{"block", "{ const y = 1; }", false},
		{"expression", "x;", false},
		{"empty", ";", false},
	} {
		native := "function g(xs: any) { for (const x of xs) " + body.text + " }"
		want, observed := rejects(native)
		if want != body.declaration {
			t.Fatalf("native control changed: TS1156=%v for %q (%s)", want, native, observed)
		}
		for _, loop := range []struct {
			name, head string
			concurrent bool
		}{
			{"for-try", "for try (const x of xs)", false},
			{"for-concurrent", "for concurrent (const x of xs)", true},
			{"for-concurrent-limit", "for concurrent (2) (const x of xs)", true},
		} {
			t.Run(loop.name+"/"+body.name, func(t *testing.T) {
				source := "effect function f(xs: any) { " + loop.head + " " + body.text + " }"
				got, observed := rejects(source)
				if got && !want {
					t.Fatalf("a Statement body reports TS1156 (%s):\n%s", observed, source)
				}
				if want && !got {
					Gap(t, "FuzzGrammarAdmission", key, "a native for-of reports TS1156 for this body; this loop reports %s\nprogram:\n%s", observed, source)
				}
				if want && loop.concurrent {
					ExpectPending(t, "FuzzGrammarAdmission", key)
				}
			})
		}
	}
}
