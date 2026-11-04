package vibelang

import "testing"

// Chapter 001 bans every IdentifierReference to the global Function.
// A shorthand has separate property and value symbols; only the value counts.
func TestLegacyFunctionShorthand(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"module", "export const x = { Function }", 1},
		{"plain", "export function f() { return { Function } }", 1},
		{"effect", "export effect function f() { return { Function } }", 1},
		{"async", "export async function f() { return { Function } }", 1},
		{"type-shadow", "type Function = number; export const x = { Function }", 1},
		{"local-control", "const Function = 1; export const x = { Function }", 0},
		{"parameter-control", "export function f(Function: number) { return { Function } }", 0},
		{"destructure-control", "export const { Function = () => 1 } = {} as { Function?: () => number }; export const x = { Function }", 0},
		{"property-control", "export const x = { Function: 1 }", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Source() == "EK" && d.Code() == 107 {
					count++
					if got := f.Text()[d.Loc().Pos():d.Loc().End()]; got != "Function" {
						t.Errorf("span %q, want Function", got)
					}
				}
			}
			if count != tc.want {
				t.Fatalf("EK0107 count %d, want %d: %s", count, tc.want, tc.source)
			}
		})
	}
}
