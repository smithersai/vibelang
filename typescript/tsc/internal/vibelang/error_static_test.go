package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorStaticMembers(t *testing.T) {
	for _, source := range []string{
		"error E { static x = 1 }",
		"error E { static make() { return 1 } }",
		"error E { static get count() { return 1 } }",
		"error E { static {} }",
		"schema error E { static x = 1 }",
		"schema error E { static make() { return 1 } }",
		"schema error E { static get count() { return 1 } }",
		"schema error E { static {} }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source+"\n")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError && d.Code() == 1302 {
					return
				}
			}
			t.Fatal("missing EK1302 for user-written static member")
		})
	}
}

func TestErrorStaticMembersOnlyDeclarations(t *testing.T) {
	source := "error E { id: string; get message() { return this.id } }\nschema error S { id: string }\nclass C extends Data.TaggedError(\"C\") { static x = 1 }\nclass D extends Schema.TaggedError<D>()(\"D\", {}) { static x = 1 }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 1302 {
			t.Errorf("valid class: %s", d.String())
		}
	}
}
