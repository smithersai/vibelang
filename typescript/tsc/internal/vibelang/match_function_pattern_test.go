package vibelang

import (
	"strings"
	"testing"
)

// Chapter 004, Class patterns: "The global `Function` still reports `EK0107`;
// use a `typeof` guard." A pattern names the problem once, with that advice.
func TestFunctionClassPatternReportsOnce(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         int
		pattern      bool
	}{
		{"match", "export function f(s: unknown) { return match (s) { when Function: 1; default: 0; } }", 1, true},
		{"is", "export function f(s: unknown) { return s is Function }", 1, true},
		{"extractor", "export function f(s: unknown) { return match (s) { when Function(let g): 1; default: 0; } }", 1, true},
		{"global-member", "export function f(s: unknown) { return match (s) { when globalThis.Function: 1; default: 0; } }", 1, true},
		{"global-is", "export function f(s: unknown) { return s is globalThis.Function }", 1, true},
		{"global-element", "export function f(s: unknown) { return s is globalThis[\"Function\"] }", 1, true},
		{"global-extractor", "export function f(s: unknown) { return match (s) { when globalThis.Function(let g): 1; default: 0; } }", 1, true},
		{"two-arms", "export function f(s: unknown) { return match (s) { when Function: 1; when [Function]: 2; default: 0; } }", 2, true},
		{"value", "export const g = Function", 1, false},
		{"subject", "export function f() { return match (Function) { when let g: 1; } }", 1, false},
		{"instanceof", "export function f(s: unknown) { return s instanceof Function }", 0, false},
		{"local-class", "class Function {}\nexport function f(s: unknown) { return s is Function }", 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, test.source)
			var messages []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Source() == "EK" && d.Code() == EK0107.Code {
					messages = append(messages, d.MessageText())
				}
			}
			if len(messages) != test.want {
				t.Fatalf("got %d EK0107, want %d: %q\n%s", len(messages), test.want, messages, test.source)
			}
			for _, m := range messages {
				if strings.Contains(m, "typeof guard") != test.pattern {
					t.Fatalf("pattern advice %v in %q\n%s", test.pattern, m, test.source)
				}
			}
		})
	}
}
