package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestExplicitServiceKeyScopes(t *testing.T) {
	const named = `{"name":"key-tests","type":"module"}`
	for _, test := range []struct {
		name, source, pkg string
		count             int
	}{
		{"module", "service Root { n: number }", named, 0},
		{"namespace", "namespace Keys { export service Root { n: number } }", named, 0},
		{"function", "function f(): number { service Local { n: number }; return 1 }", named, 1},
		{"blocks", "{ service A { n: number } }\n{ service B { n: number } }", named, 2},
		{"local explicit", `function f(): number { service Local { static readonly key = "local/Key"; n: number }; return 1 }`, named, 0},
		{"empty explicit", `service Empty { static readonly key = ""; n: number }`, `{"type":"module"}`, 0},
		{"unnamed package", "service Missing { n: number }", `{"type":"module"}`, 1},
		{"numeric name", "service Missing { n: number }", `{"name":12,"type":"module"}`, 1},
		{"empty string name", "service Named { n: number }", `{"name":"","type":"module"}`, 0},
		{"outside package", "service Missing { n: number }", "", 1},
		{"legacy typed shape", "interface Api { n: number }; service Typed: Api", `{"type":"module"}`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgramWithPackage(t, test.source, test.pkg)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 903 {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != test.count {
				t.Fatalf("got %d EK0903, want %d", count, test.count)
			}
		})
	}
}
