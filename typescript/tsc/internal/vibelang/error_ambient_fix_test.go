package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestAmbientErrorDeclarationQuickFix(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, body := range []string{"", " { id: string }"} {
			for i, context := range []string{
				"declare %s\nexport {}\n",
				"export declare %s\n",
				"declare namespace API { export %s }\nexport {}\n",
				"declare namespace API { namespace Nested { export %s } }\nexport {}\n",
				"declare global { %s }\nexport {}\n",
			} {
				t.Run(fmt.Sprintf("%s/body%t/context%d", form, body != "", i), func(t *testing.T) {
					source := fmt.Sprintf(context, form+" Missing"+body)
					fixed := applyQuickFixOf(t, source, 1307, diagnostics.CategoryError)
					if !strings.Contains(fixed, "class Missing") || strings.Contains(fixed, "error Missing") {
						t.Fatalf("the preserving fix must write a native class:\n%s", fixed)
					}
					program, file, _, _ := editorProgram(t, fixed)
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError || d.Code() == 4830 || d.Code() == 4837 {
							t.Errorf("fixed ambient class must remain valid without a reverse teaching rewrite: %s\n%s", d.String(), fixed)
						}
					}
				})
			}
		}
	}
}
