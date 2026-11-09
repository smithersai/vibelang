package vibelang

import (
	"strings"
	"testing"
)

// Class patterns use resolved call/construct signatures, not the callee spelling.
func TestShadowedFunctionPatternAdmission(t *testing.T) {
	for _, name := range []string{"Matcher", "Function"} {
		for _, typ := range []string{"(s: unknown) => number", "(s: unknown) => void", "unknown", "any", "{}"} {
			for _, form := range []string{"arm", "is", "extract"} {
				t.Run(name+"/"+typ+"/"+form, func(t *testing.T) {
					expr := "s is " + name
					if form == "arm" {
						expr = "match (s) { when " + name + ": 1; default: 0; }"
					}
					if form == "extract" {
						expr = "match (s) { when " + name + "(let x): x; default: 0; }"
					}
					source := "export function f(s: unknown, " + name + ": " + typ + ") { return " + expr + " }"
					p, f, _, _ := editorProgram(t, source)
					n := 0
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Source() == "EK" && d.Code() == 702 {
							n++
						}
						if d.Source() == "EK" && d.Code() == 107 {
							t.Errorf("local binding banned: %s", d.String())
						}
					}
					if n != 1 {
						t.Fatalf("want one EK0702, got %d\n%s", n, source)
					}
				})
			}
		}
	}
	for _, source := range []string{
		"export function f(s: unknown, Function: (s: unknown) => boolean) { return s is Function }",
		"export function f(s: unknown, Function: (s: unknown) => Iterable<unknown> | false) { return match (s) { when Function(let x): x; default: 0; } }",
		"export function f(s: unknown) { class Function {}; return s is Function }",
	} {
		p, f, _, _ := editorProgram(t, source)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if strings.HasPrefix(d.Source(), "EK") {
				t.Errorf("valid local matcher: %s\n%s", d.String(), source)
			}
		}
	}
}
