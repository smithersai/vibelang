package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceKeyResultInference(t *testing.T) {
	for _, read := range []string{"Key.key", "Key[\"key\"]", "Alias.key", "key"} {
		t.Run(read, func(t *testing.T) {
			source := `service Key { static readonly key = "app/Key"; value: number }
const Alias = Key
const { key } = Key
function read() { return ` + read + ` }
const exact: "app/Key" = read()
export { exact }
`
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
		})
	}
}

func TestServiceKeyInferenceKeepsWrittenAndReferenceTypes(t *testing.T) {
	for _, declaration := range []string{
		`service Key { static readonly key: string = "app/Key"; value: number }`,
		`service Key { static readonly key = "app/Key"; static readonly defaultValue = () => ({ value: 1 }); value: number }`,
		`class Key { static readonly key = "app/Key" }`,
	} {
		p, file, _, _ := editorProgram(t, declaration+`
function read() { return Key.key }
const value: ReturnType<typeof read> = "other"
export { value }
`)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
		}
	}
}
