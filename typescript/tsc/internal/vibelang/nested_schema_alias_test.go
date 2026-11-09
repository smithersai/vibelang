package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNestedSchemaAliasesCheckTypes(t *testing.T) {
	source := "namespace Models { export schema Bad = unknown }\nfunction local() { schema Bad = Set<string>; return Bad }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != EK2109.Code {
			t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
		}
		count++
	}
	if count != 2 {
		t.Fatalf("want two EK2109 diagnostics, got %d", count)
	}
}
