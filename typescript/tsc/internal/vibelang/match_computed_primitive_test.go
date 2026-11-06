package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestComputedKeyPrimitiveAdmission(t *testing.T) {
	for _, generic := range []bool{false, true} {
		for _, complete := range []bool{false, true} {
			t.Run(fmt.Sprintf("generic=%t/complete=%t", generic, complete), func(t *testing.T) {
				domain := `"x"|{_tag:"A"}`
				parameters := ""
				if generic {
					parameters = "<T extends " + domain + ">"
					domain = "T"
				}
				tail := ""
				if complete {
					tail = `when "x":2;`
				}
				source := `export {};declare global{interface String{readonly _tag:"A"}};` + fmt.Sprintf(`export function f%s(subject:%s,key:"_tag"){return match(subject){when {[key]:"A"}:1;%s}}`, parameters, domain, tail)
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() == EK4701.Code {
						count++
					} else {
						t.Error(d.String())
					}
				}
				want := 1
				if complete {
					want = 0
				}
				if count != want {
					t.Errorf("got %d EK4701, want %d\n%s", count, want, source)
				}
			})
		}
	}
}
