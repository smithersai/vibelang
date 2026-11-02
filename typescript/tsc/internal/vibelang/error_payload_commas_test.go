package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorPayloadCommaSeparators(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, c := range []struct{ name, body, args, read, typ string }{
			{"fields", "id: string, count: number", "id: \"x\", count: 1", "value.count", "number"},
			{"optional", "id?: string, count: number", "count: 1", "value.count", "number"},
			{"literal", "\"id\": string, 7: number", "id: \"x\", 7: 1", "value[7]", "number"},
			{"members", "id: string, get label(): string { return this.id } count: number", "id: \"x\", count: 1", "value.label", "string"},
			{"readonly", "readonly id: string, readonly count: number", "id: \"x\", count: 1", "value.count", "number"},
			{"comments", "id: string /* before */, /** @internal */ count: number,", "id: \"x\", count: 1", "value.count", "number"},
			{"multiline", "id:\n string |\n number,\ncount?: number", "id: \"x\"", "value.id", "string | number"},
			{"trailing", "id: string,", "id: \"x\"", "value.id", "string"},
		} {
			t.Run(form+"/"+c.name, func(t *testing.T) {
				source := fmt.Sprintf("export %s Entry { %s }\nconst value = new Entry({ %s })\nexport const checked: %s = %s\n", form, c.body, c.args, c.typ, c.read)
				program, file, _, _ := editorProgram(t, source)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("shared Field Separator admits this comma: %s", d.String())
					}
				}
			})
		}
	}
}

func TestErrorCommaDoesNotAdmitClassPunctuation(t *testing.T) {
	for _, source := range []string{
		"class Native { declare id: string, declare count: number }",
		"error Entry { static count: number, id: string }",
		"error Entry { get label() { return 1 }, id: string }",
		"error Entry { id: string,, count: number }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				found = found || d.Category() == diagnostics.CategoryError
			}
			if !found {
				t.Errorf("invalid class punctuation accepted: %s", source)
			}
		})
	}
}
