package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestLocalPrimitiveExtractorSignature(t *testing.T) {
	for _, name := range []string{"String", "Number", "Boolean", "BigInt", "Symbol", "Matcher"} {
		for _, test := range []struct {
			typ  string
			want int
		}{
			{"(s: unknown) => Iterable<unknown> | false", 0},
			{"(s: unknown) => boolean", 1},
			{"(s: unknown) => number", 1},
			{"(s: unknown) => never", 0},
		} {
			t.Run(name+"/"+test.typ, func(t *testing.T) {
				source := "export function f(s: unknown, " + name + ": " + test.typ + ") { return match (s) { when " + name + "(let x): x; default: 0; } }"
				p, f, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Source() == "EK" && d.Code() == 702 {
						count++
					} else if d.Category() == diagnostics.CategoryError {
						t.Errorf("unexpected %s", d.String())
					}
				}
				if count != test.want {
					t.Fatalf("want %d EK0702 got %d\n%s", test.want, count, source)
				}
			})
		}
	}
}
