package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSignedZeroObjectHygiene(t *testing.T) {
	for _, literal := range []string{"-0", "+0", "-0.0", "+0e0", "-0x0", "+0b0", "-0.0_0", "-1e-400"} {
		for i, body := range []string{
			"const Object = { is() { return true } }; return match(value) { when %s: true; default: false; }",
			"const Object = 0; return value is %s",
			"const Obj\u0065ct = { is() { return false } }; return match(value) { when %s: true; default: false; }",
			"const Object = undefined; return match({ n: value }) { when { n: %s }: true; default: false; }",
			"const $global = 0; return match(value) { when %s: true; default: false; }",
			"const runtime = 0; const Object = undefined; return value is %s",
		} {
			t.Run(fmt.Sprintf("%s/%d", literal, i), func(t *testing.T) {
				source := "export function witness(value: unknown) { " + fmt.Sprintf(body, literal) + " }"
				p, f, _, _ := editorProgram(t, source)
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Error(d.String())
					}
				}
			})
		}
	}
}

func TestSignedZeroCoverageAfterHygiene(t *testing.T) {
	for _, literal := range []string{"-0", "+0", "-0.0", "+0e0", "-1e-400"} {
		for _, both := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%t", literal, both), func(t *testing.T) {
				arms := "when " + literal + ": 1;"
				if both {
					arms += " when +0: 2; when -0: 3;"
				}
				source := "export function f(n: 0 | 1) { return match(n) { " + arms + " when 1: 4; } }"
				p, f, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Code() == EK4701.Code {
						count++
						// The diagnostic must still explain the signed arm's missing credit.
						notes := ""
						for _, info := range d.MessageChain() {
							notes += info.String()
						}
						if !strings.Contains(notes, "SameValue") {
							t.Errorf("missing signed-zero explanation: %s; notes %s", d.String(), notes)
						}
					} else if d.Category() == diagnostics.CategoryError {
						t.Error(d.String())
					}
				}
				if count != 1 {
					t.Fatalf("got %d EK4701 diagnostics, want one", count)
				}
			})
		}
	}
}

// A signed-zero test fails, without coercion or an unrelated TS2367, on a
// statically nonnumeric subject too. The helper must not infer that subject's
// singleton type as the type against which its internal zero is compared.
func TestSignedZeroTypedSubjects(t *testing.T) {
	for _, typ := range []string{"string", "boolean", "bigint", "symbol", "object", "null", "undefined", "1", "0"} {
		t.Run(typ, func(t *testing.T) {
			source := "export function f(value: " + typ + ") { return [value is -0, match(value) { when +0: true; default: false; }] }"
			p, f, _, _ := editorProgram(t, source)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("TS%d: %s", d.Code(), d.String())
				}
			}
		})
	}
}

func TestSignedZeroNoteIgnoresNestedMatch(t *testing.T) {
	source := "export function f(n: 0 | 1) { return match(n) { when 1: do { const value = match(n) { when -0: 7; default: 8; }; value }; } }"
	p, f, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Code() == EK4701.Code {
			count++
			for _, note := range d.MessageChain() {
				if strings.Contains(note.String(), "SameValue") {
					t.Errorf("nested arm credited as outer arm: %s", note.String())
				}
			}
		} else if d.Category() == diagnostics.CategoryError {
			t.Errorf("TS%d: %s", d.Code(), d.String())
		}
	}
	if count != 1 {
		t.Fatalf("outer missing zero: got %d diagnostics, want one", count)
	}
}

// Chapter 004's signed-zero counterpart uses Object.is, which does not
// narrow unknown to 0. Hygiene must preserve that native typing contract.
func TestSignedZeroNativeNarrowing(t *testing.T) {
	for i, source := range []string{
		"export function f(value: unknown) { if (value is -0) { const zero: 0 = value; return zero } return 2 }",
		"export function f(value: unknown) { return match(value) { when -0: do { const zero: 0 = value; zero }; default: 2; } }",
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			p, f, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Code() == 2322 {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("TS%d: %s", d.Code(), d.String())
				}
			}
			if count != 1 {
				t.Fatalf("native Object.is typing requires one TS2322, got %d", count)
			}
		})
	}
}
