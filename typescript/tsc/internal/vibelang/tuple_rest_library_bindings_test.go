package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-15/detail286 selects generic mappings by library type binding.
// Rest mapping must use that same binding rule, independently of tuple mutability.
func TestTupleRestLibraryBindingsProbe(t *testing.T) {
	const aliases = "namespace N {export import Sequence=globalThis.Array;export import Frozen=globalThis.ReadonlyArray};"
	for _, tc := range []struct {
		name, source string
		errors       int
	}{
		{"canonical array", "schema S=readonly [...Array<number>]", 0},
		{"canonical readonly array", "schema S=[...ReadonlyArray<number>]", 0},
		{"qualified array", "schema S=readonly [...globalThis.Array<number>]", 0},
		{"qualified readonly array", "schema S=[...globalThis.ReadonlyArray<number>]", 0},
		{"renamed array", aliases + "schema S=readonly [...N.Sequence<number>]", 0},
		{"renamed readonly array", aliases + "schema S=[...N.Frozen<number>]", 0},
		{"grouped renamed", aliases + "schema S=[...(N.Sequence<number>)]", 0},
		{"trailing slot", aliases + "schema S=readonly [string,...N.Sequence<number>,boolean]", 0},
		{"normal alias array control", aliases + "schema S=N.Sequence<number>", 0},
		{"value only control", "const Array=1;schema S=[...Array<number>]", 0},
		{"shadow array", "type Array<T>={n:T};schema S=[...Array<number>]", 1},
		{"shadow readonly array", "type ReadonlyArray<T>={n:T};schema S=[...ReadonlyArray<number>]", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() != EK2109.Code {
					t.Errorf("unexpected %s", d.String())
				}
				count++
			}
			if count != tc.errors {
				t.Fatalf("errors %d, want %d", count, tc.errors)
			}
		})
	}
}
