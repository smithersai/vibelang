package vibelangfuzz

import (
	"context"
	"testing"
)

// TypeScript parses each form below for recovery and its checker rejects it
// with a grammar diagnostic. None has an Appendix A derivation, so the
// rejection is the agreement the oracle looks for: a `with` statement in
// strict code (TS1101), a quoted module name outside an ambient context
// (TS1035), a type annotation on a for-of head (TS2483), a type predicate
// outside a return type (TS1228), a decorator where none can stand (TS1206)
// and a decorator expression that needs parentheses (TS1497).
func TestGrammarAdmissionNativeRejections(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source string
		code   int32
	}{
		{"with (o) { }", 1101},
		{"function g(p: object) { with (p) { } }", 1101},
		{"effect function f(p: object) { with (p) { } }", 1101},
		{"module \"s\" { }", 1035},
		{"for (const x: number of xs) { }", 2483},
		{"type T = asserts x;", 1228},
		{"@dec function g() { }", 1206},
		{"@effect { } class C { }", 1497},
	} {
		t.Run(c.source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && d.Code() == c.code {
					found = grammarAdmissionSyntaxDiagnostic(d)
				}
			}
			if !found {
				t.Fatalf("TS%d is not reported as a syntax rejection: %v", c.code, result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, c.source) {
				t.Errorf("a natively rejected form is an admission gap: %q", c.source)
			}
		})
	}
}
