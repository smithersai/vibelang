package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestSchemaDataDecoratorRecovery(t *testing.T) {
	forms := []string{"schema Named { n: number }", "schema Named = number", "data Named { A }", "data Named<T> { A { n:T } }"}
	for i, form := range forms {
		for j, prefix := range []string{"@dec ", "export @dec ", "@dec export ", "@dec @dec "} {
			for _, nested := range []bool{false, true} {
				t.Run(fmt.Sprintf("form%d/prefix%d/nested%t", i, j, nested), func(t *testing.T) {
					defer func() {
						if value := recover(); value != nil {
							t.Errorf("declaration recovery panicked: %v", value)
						}
					}()
					source := prefix + form + "; const after=1;"
					if nested {
						source = "namespace Box { " + source + " }"
					}
					p, f, _, _ := editorProgram(t, "declare const dec:unknown;"+source)
					count := 0
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Source() == "" && d.Code() == 1206 {
							count++
							continue
						}
						t.Errorf("unexpected %s\n%s", d.String(), source)
					}
					if count != 1 {
						t.Errorf("want one TS1206, got %d\n%s", count, source)
					}
				})
			}
		}
	}
}
