package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestBrandedPrimitiveMatchDomain(t *testing.T) {
	for _, primitive := range []string{"string", "number", "boolean", "bigint", "symbol"} {
		for _, generic := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/generic=%v", primitive, generic), func(t *testing.T) {
				source := "type P=" + primitive + `&{readonly _tag:"P"};type S=P|{_tag:"O"};`
				parameters, subject := "", "S"
				if generic {
					parameters = "<T extends S>"
					subject = "T"
				}
				source += fmt.Sprintf(`export function f%s(s:%s){return match(s){when {_tag:"O"}:1;}}`, parameters, subject)
				program, file, _, _ := editorProgram(t, source)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("%s\n%s", d.String(), source)
					}
				}
			})
		}
	}
}

func TestObjectIntersectionMatchDomain(t *testing.T) {
	for _, domain := range []string{
		`{_tag:"P"}&{field:number}`,
		`({_tag:"P"}&{field:number})&{other:string}`,
		`String&{_tag:"P"}`,
		`Number&{_tag:"P"}`,
		`Boolean&{_tag:"P"}`,
	} {
		for _, generic := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/generic=%v", domain, generic), func(t *testing.T) {
				source := "type P=" + domain + `;type S=P|{_tag:"O"};`
				parameters, subject := "", "S"
				if generic {
					parameters = "<T extends S>"
					subject = "T"
				}
				source += fmt.Sprintf(`export function f%s(s:%s){return match(s){when {_tag:"O"}:1;}}`, parameters, subject)
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() == 4701 {
						count++
					} else {
						t.Error(d.String())
					}
				}
				if count != 1 {
					t.Errorf("object intersection lost finite check: got %d EK4701", count)
				}
			})
		}
	}
}
