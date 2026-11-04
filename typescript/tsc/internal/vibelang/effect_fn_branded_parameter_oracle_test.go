package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Aliases and expanded intersections may print differently while preserving
// the same type. Check both directions and reject any, unknown and other brands.
func brandedParameterIdentityErrors(t *testing.T, source string) int {
	t.Helper()
	const probe = `
type SameParameter<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
    ? (<T>() => T extends Y ? 1 : 2) extends (<T>() => T extends X ? 1 : 2) ? true : false
    : false
const sameParameter: SameParameter<Parameters<typeof cleanup>[0], Path> = true
`
	p, f, _, _ := editorProgram(t, source+probe)
	count := 0
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != 2322 {
			t.Fatalf("unexpected parameter oracle diagnostic: %s", d.String())
		}
		count++
	}
	return count
}

func TestEffectFnBrandedParameterOracleControls(t *testing.T) {
	for _, tc := range []struct {
		name, parameter string
		errors          int
	}{
		{"alias", "Path", 0},
		{"expanded", `string & { readonly [brand]: "Path" }`, 0},
		{"unbranded", "string", 1},
		{"other brand", `string & { readonly [brand]: "Other" }`, 1},
		{"any", "any", 1},
		{"unknown", "unknown", 1},
		{"optional value", "Path | undefined", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := fmt.Sprintf(`declare const brand: unique symbol
type Path = string & { readonly [brand]: "Path" }
effect function cleanup(input: %s) { return input }
`, tc.parameter)
			if count := brandedParameterIdentityErrors(t, source); count != tc.errors {
				t.Fatalf("parameter identity errors=%d, want %d", count, tc.errors)
			}
		})
	}
}
