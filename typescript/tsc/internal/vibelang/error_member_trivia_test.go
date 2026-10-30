package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorStaticMemberFixKeywordTrivia(t *testing.T) {
	for _, tc := range []struct {
		name   string
		source string
		keep   []string
	}{
		{"error-comment", "export error /* declaration */ E { id: string; static x = 1 }\n", []string{"/* declaration */"}},
		{"schema-comments", "export schema /* kind */ error /* declaration */ E { id: string; static x = 1 }\n", []string{"/* kind */", "/* declaration */"}},
		{"error-nbsp", "export error\u00a0E { id: string; static x = 1 }\n", nil},
		{"schema-nbsp", "export schema\u00a0error\u00a0E { id: string; static x = 1 }\n", nil},
		{"shadowed-data", "const Data = 0; export error /* error schema */ E { id: string; static x = 1 }\n", []string{"/* error schema */"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixed := applyQuickFixOf(t, tc.source, 1302, diagnostics.CategoryError)
			for _, comment := range tc.keep {
				if !strings.Contains(fixed, comment) {
					t.Errorf("lost comment %s: %s", comment, fixed)
				}
			}
			program, file, _, _ := editorProgram(t, fixed+"\nconst id: string = new E({ id: \"x\" }).id; const value: number = E.x;\n")
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s\n%s", d.String(), fixed)
				}
			}
		})
	}
}
