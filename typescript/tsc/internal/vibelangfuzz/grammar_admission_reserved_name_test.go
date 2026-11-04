package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

const grammarFiberReservedNameQuote = "a parameter or local named `join` is a syntax error (`EK1702`)"
const grammarFiberExpressionSyntaxQuote = "as `(async function await() { })` is a SyntaxError"

func TestGrammarAdmissionReservedNameQuoted(t *testing.T) {
	text := SpecText(grammarAppendix)
	for _, quote := range []string{grammarFiberReservedNameQuote, grammarFiberExpressionSyntaxQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Appendix A reserved-name syntax changed: %s", quote)
		}
	}
}

// The checker diagnoses some reserved own names after parser recovery. They
// reject syntax just as the native async-expression counterpart does. Keep
// declarations/methods and operand type errors outside this rejection boundary.
func TestGrammarAdmissionReservedNameDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	check := func(t *testing.T, source string, want bool) {
		t.Helper()
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 1702 {
				found = true
				if !grammarAdmissionSyntaxDiagnostic(d) {
					t.Errorf("EK1702 did not reject syntax: %s", source)
				}
			}
		}
		if found != want {
			t.Fatalf("reserved-name diagnostic=%v, want %v: %s", found, want, source)
		}
	}
	for _, word := range []string{"fork", "join"} {
		for _, kind := range []string{"effect function ", "effect function* "} {
			for _, wrapper := range []string{"const value = %s;", "throw %s;", "function outer() { return %s; }", "const values = [%s];"} {
				source := fmt.Sprintf(wrapper, kind+word+"(p: number) {}")
				t.Run(source, func(t *testing.T) { check(t, source, true) })
			}
		}
	}
	for _, source := range []string{
		"effect function fork() {}",
		"effect function join() {}",
		"const value = function join() {};",
		"const value = { effect join() {} };",
	} {
		t.Run(source, func(t *testing.T) { check(t, source, false) })
	}
}
