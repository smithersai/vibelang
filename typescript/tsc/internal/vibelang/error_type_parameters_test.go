// 003-failures.md: TestErrorTypeParameterBan rejects generic plain and schema errors with EK1303
// rule: docs/design/src/003-failures.md#2b6dbd98a5d21169
package vibelang

import (
	"testing"
)

func TestErrorTypeParameterBan(t *testing.T) {
	for _, source := range []string{"export error E<T> { value: T }\n", "export schema error E<T> {}\n"} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 1303 {
					return
				}
			}
			t.Fatal("missing EK1303 for type parameters")
		})
	}
}
