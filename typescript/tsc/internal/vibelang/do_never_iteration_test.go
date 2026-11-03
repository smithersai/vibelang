package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Stock TypeScript 5.9.3 and 7.1.0-beta both reject native protocol uses of
// never with TS2488 (TS2504 for for-await); array literal spread is accepted.
func TestDoNeverIterationMatchesTypeScript(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"for-of", "export function f() { for (const item of do { return 5; [1] }) {} }", 2488},
		{"for-await", "export async function f() { for await (const item of do { return 5; [1] }) {} }", 2504},
		{"binding", "export function f() { const [item] = do { return 5; [1] }; return item }", 2488},
		{"assignment", "export function f() { let item: unknown; [item] = do { return 5; [1] }; return item }", 2488},
		{"yield-star", "export function* f() { yield* do { return; [1] } }", 2488},
		{"call-spread", "function take(...items: number[]) {} export function f() { take(...do { return 5; [1] }) }", 2488},
		{"array-spread", "export function f() { return [...do { return 5; [1] }] }", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				count++
				if tc.code == 0 || d.Source() != "" || d.Code() != tc.code || !strings.Contains(d.String(), "never") {
					t.Errorf("need native TS%d for never: %s", tc.code, d.String())
				}
			}
			want := 1
			if tc.code == 0 {
				want = 0
			}
			if count != want {
				t.Fatalf("want %d errors, got %d", want, count)
			}
		})
	}
}
