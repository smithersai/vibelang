package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const doNeverCompletionTarget = "FuzzDoNeverCompletion"
const doNeverFuzzOutwardPathsQuote = "Paths leaving outward by `return`, `break`, `continue` or `throw` supply no normal result, and a do expression with no normal path has type `never`."

func TestDoNeverFuzzOutwardPathsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), doNeverFuzzOutwardPathsQuote) {
		t.Fatalf("VIP-2 no longer says %q; update the oracle", doNeverFuzzOutwardPathsQuote)
	}
}

// Generate abrupt-only blocks and neighbouring normal/empty completions.
// The spec requires never only for the abrupt-only blocks. A TS2322 on
// the normal controls proves the oracle does not accept an any-valued result.
func FuzzDoNeverCompletion(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range []string{"return", "throw", "branches", "break", "continue", "finally", "switch", "empty", "value", "mixed-empty", "mixed-value", "bad-return", "ordered-operand"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(3))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestDoNeverFuzzOutwardPathsQuoted(t)
		defer recoverCompilerPanic(t, doNeverCompletionTarget)
		body, before, after := "return 5", "", ""
		wantError := false
		switch key {
		case "throw":
			body = "throw 5"
		case "branches":
			body = "if (condition) return 5; else throw 6"
		case "break":
			before, body, after = "outer: while (condition) {", "break outer", "}"
		case "continue":
			before, body, after = "outer: while (condition) {", "continue outer", "}"
		case "finally":
			body = "try { 1 } finally { return 5 }"
		case "switch":
			body = "switch (condition) { case true: return 5; default: throw 6 }"
		case "empty":
			body, wantError = "{}", true
		case "value":
			body, wantError = "5", true
		case "mixed-empty":
			body, wantError = "if (condition) return 5; else {}", true
		case "mixed-value":
			body, wantError = "if (condition) return 5; else 6", true
		case "ordered-operand":
			body = "return 5"
		case "bad-return":
			body, wantError = "return 'wrong'", true
		default:
			key = "return"
		}
		for range int(variant % 4) {
			body = "(do { " + body + " })"
		}
		callable := "function stopped(condition: boolean): number"
		if key == "throw" || key == "branches" || key == "switch" {
			// VIP-4 permits native throw in async code, not plain VibeLang code.
			// Preserve the VIP-2 completion oracle in a legal enclosing callable.
			callable = "async function stopped(condition: boolean): Promise<number>"
		}
		source := callable + " { " + before + "const value: never = do { " + body + " }; return value; " + after + " return 0 }"
		codes := doContextualNegativeCodes(t, w, "main.vibe", source)
		want := "[]"
		if wantError {
			want = "[TS2322]"
		}
		if key == "ordered-operand" {
			source = "function stopped(condition: boolean): number { function take(value: string, ignored: never): number { return 0 }; return take((() => 123)(), do { " + body + " }) }"
			codes = doContextualNegativeCodes(t, w, "main.vibe", source)
			want = "[TS2345]"
		}
		gap := fmt.Sprintf("%s:depth-%d", key, variant%4)
		if fmt.Sprint(codes) != want {
			Gap(t, doNeverCompletionTarget, gap, "VIP-2: %s; want %s, got %v\n%s", doNeverFuzzOutwardPathsQuote, want, codes, source)
		}
		ExpectPending(t, doNeverCompletionTarget, gap)
	})
}
