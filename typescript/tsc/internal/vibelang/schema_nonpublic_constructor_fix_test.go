package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorNonPublicConstructorClassFix(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		for _, access := range []string{"private", "protected"} {
			for _, payload := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/payload=%t", kind, access, payload), func(t *testing.T) {
					field, call := "", "super()"
					if payload {
						field = "id:string;"
						call = "super({id:'value'})"
					}
					source := "export " + kind + " Entry{" + field + access + " constructor(){" + call + "}}" + "\nexport function probe(subject:unknown){return match(subject){when Entry(let item):item;default:undefined;}}"
					fixed := applyQuickFixOf(t, source, 1301, diagnostics.CategoryError)
					program, file, _, _ := editorProgram(t, fixed)
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("upgrade failed: %s\n%s", d.String(), fixed)
						}
					}
				})
			}
		}
	}
}
