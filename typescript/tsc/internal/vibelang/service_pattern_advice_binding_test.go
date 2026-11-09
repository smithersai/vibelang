package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServicePatternAdviceBinding(t *testing.T) {
	for _, member := range []string{"default", "class", "return", "import", "yield", "await", "eval", "arguments", "fork", "join", "region"} {
		for _, mode := range []string{"plain", "effect", "async"} {
			t.Run(member+"/"+mode, func(t *testing.T) {
				modifier, expression := "", "return "
				if mode == "effect" {
					modifier, expression = "effect ", "return "
				}
				if mode == "async" {
					modifier = "async "
				}
				prefix := fmt.Sprintf("export service S { static readonly key = \"advice/S\"; %s: number }\nexport %sfunction read(input: unknown) { %s", member, modifier, expression)
				source := prefix + "match (input) { when S: 1; default: 0; } }"
				p, file, _, _ := editorProgram(t, source)
				advice := ""
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == 3004 {
						text := d.String()
						start := strings.Index(text, "when { ")
						if start < 0 {
							t.Fatalf("missing member-pattern advice: %s", text)
						}
						advice = strings.TrimSuffix(text[start:], ".")
					} else if d.Category() == diagnostics.CategoryError {
						t.Errorf("fixture: %s", d.String())
					}
				}
				if advice == "" {
					t.Fatal("missing EK3004")
				}
				repaired := prefix + "match (input) { " + advice + ": 1; default: 0; } }"
				checked, repairedFile, _, _ := editorProgram(t, repaired)
				ds := checked.GetSyntacticDiagnostics(t.Context(), repairedFile)
				ds = append(ds, checked.GetSemanticDiagnostics(t.Context(), repairedFile)...)
				for _, d := range ds {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("suggested pattern rejected: %s\n%s", d.String(), repaired)
					}
				}
			})
		}
	}
}
