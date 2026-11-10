package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A service's twin extends Context.Service, so super inside its rejected
// constructor is no TypeScript error; super of a nested class keeps TS2335.
func TestServiceSuperDerivation(t *testing.T) {
	cases := []struct {
		name, shape, member string
		ts2335              int
	}{
		{"body-call", "", "constructor() { super() }", 0},
		{"body-arrow", "", "constructor() { super(); const f = () => super.toString(); f() }", 0},
		{"whole-call", ": {value:number}", "constructor() { super() }", 0},
		{"body-nested-class", "", "constructor() { super(); class Inner { m() { return super.toString() } }; new Inner() }", 1},
		{"whole-nested-class", ": {value:number}", "constructor() { super(); class Inner { constructor() { super() } }; new Inner() }", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source := "export service S" + tc.shape + " { static readonly key = \"super/S\"; " + tc.member + " }"
			p, file, _, _ := editorProgram(t, source)
			got := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					got[d.Code()]++
				}
			}
			if got[902] != 1 || got[2335] != tc.ts2335 || len(got) != 1+min(tc.ts2335, 1) {
				t.Fatalf("want EK0902 and %d TS2335, got %v: %s", tc.ts2335, got, source)
			}
		})
	}
}
