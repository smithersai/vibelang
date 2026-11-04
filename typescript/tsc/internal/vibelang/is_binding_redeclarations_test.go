package vibelang

import (
	"slices"
	"testing"
)

// VIP-7/detail 245 requires the diagnostics of a lexical declaration. The
// synthesized pattern initialization must not assign to an earlier local or
// parameter after the binder gives the duplicate its own recovery symbol.
func TestIsBindingRedeclarationDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         []int32
	}{
		{"two patterns", "export function f(a: unknown, b: unknown) { if (a is {id: let id}) return id; if (b is {id: let id}) return id; }", []int32{2451, 2451}},
		{"distinct duplicate types", "export function f(a: number, b: string) { if (a is let id) {} if (b is let id) {} }", []int32{2451, 2451}},
		{"local const", "export function f(a: unknown) { const id = 0; if (a is {id: let id}) return id; }", []int32{2451, 2451}},
		{"parameter", "export function f(id: number, a: unknown) { if (a is {id: let id}) return id; }", []int32{2300, 2300}},
		{"later const", "export function f(a: unknown) { if (a is {id: let id}) return id; const id = 0; }", []int32{2451, 2451}},
		{"source const assignment", "export function f(a: unknown) { const id = 0; if (a is {id: let id}) {} id = 2; }", []int32{2451, 2451, 2588}},
		{"source pattern const assignment", "export function f(a: number) { if (a is const id) { id = 2; } }", []int32{2588}},
		{"source type mismatch", "export function f(a: number) { if (a is let id) { id = \"bad\"; } }", []int32{2322}},
		// Redeclaration recovery must not change inference in legal shadowing homes.
		{"legal shadow inference unchanged", "export function f(a: number, b: any) { { if (b is let id) {} } if (a is let id) return id.toUpperCase(); return \"\"; }", []int32{2339}},
		{"separate homes", "export function f(a: unknown, b: unknown) { { if (a is {id: let id}) return id; } { if (b is {id: let id}) return id; } }", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got []int32
			for _, d := range errorsOf(t, tc.source) {
				got = append(got, d.Code())
			}
			slices.Sort(got)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("diagnostics %v, want %v\n%s", got, tc.want, tc.source)
			}
		})
	}
}
