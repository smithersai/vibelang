package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 004: pattern early errors of the pinned draft are EK0707, and the
// forms Appendix A admits beside them compile.
func TestMatchGrammarFollowsPinnedDraft(t *testing.T) {
	for _, row := range []struct {
		name, source string
		rejected     bool
	}{
		{"comma-arm-body", `export function f(x: unknown) { let n = 0; const r = match (x) { when 1: n++, "one"; default: "other"; }; return [r, n] as const }`, false},
		{"keyword-keys", `export function f(x: unknown) { return match (x) { when { let: 1 }: "one"; when { const: 2 }: "two"; default: "other"; } }`, false},
		{"in-arm-of-for-initializer", `export function f(o: { x: number }) { let out = 0; for (let i = match (1 as number) { when 1: "x" in o ? 5 : 0; default: 0; }; i < 6; i++) out++; return out }`, false},
		{"bound-rest", `export function f(x: unknown) { return match (x) { when { a: 1, ...let rest }: rest; default: {}; } }`, false},
		{"optional-run", `export function f(x: unknown) { return match (x) { when [1, 2?, 3?]: 1; default: 0; } }`, false},
		{"rest-name", `const rest = (v: unknown) => false; export function f(x: unknown) { return match (x) { when { a: 1, ...rest }: "matched"; default: "no"; } }`, true},
		{"required-after-optional", `export function f(x: unknown) { return match (x) { when [1, 2?, 3]: 1; default: 0; } }`, true},
		{"elision-after-optional", `export function f(x: unknown) { return match (x) { when [1, 2?, , ]: 1; default: 0; } }`, true},
		{"not-not", `export function f(x: unknown) { return match (x) { when not not 1: 1; default: 0; } }`, true},
		{"shift", `export function f(x: number) { return match (x) { when >> 1: "a"; default: "no"; } }`, true},
		{"unsigned-shift", `export function f(x: number) { return match (x) { when >>> 1: "a"; default: "no"; } }`, true},
		{"shift-assign", `export function f(x: number) { return match (x) { when >>= 1: "a"; default: "no"; } }`, true},
	} {
		t.Run(row.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, row.source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == EK0707.Code {
					count++
				} else {
					t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			want := 0
			if row.rejected {
				want = 1
			}
			if count != want {
				t.Errorf("EK0707 count %d, want %d\n%s", count, want, row.source)
			}
		})
	}
}
