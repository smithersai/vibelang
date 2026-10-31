package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceReservedStaticShapeNames(t *testing.T) {
	const source = "// expect-result: [\"payload\",7,\"payload\",7,\"alias\"]\nservice Keyed {\n static readonly key = \"static-shape/key\";\n key: string\n}\nservice Defaults {\n static readonly key = \"static-shape/default\";\n static readonly defaultValue = () => ({ defaultValue: 7 });\n defaultValue: number\n}\nservice Both {\n static readonly key = \"static-shape/both\";\n static readonly defaultValue = () => ({ key: \"payload\", defaultValue: 7 });\n key: string;\n defaultValue: number\n}\ninterface Named { key: string }\nservice Alias: Named {\n static readonly key = \"static-shape/alias\";\n static readonly defaultValue = () => ({ key: \"alias\" })\n}\n\nexport class Ordinary { static readonly key = \"identity\"; key = \"payload\" }\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
}
