package vibelang

import (
	"testing"
)

func TestAbstractErrorFixKeepsNativeClasses(t *testing.T) {
	for _, source := range []string{"export abstract class Root { abstract read(): string }\n", "export error Root { code: string }\n"} {
		program, file, _, _ := editorProgram(t, source)
		for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
			if diagnostic.Code() == 1308 {
				t.Fatalf("ordinary native/admitted declaration diagnosed: %s", diagnostic.String())
			}
		}
	}
}
