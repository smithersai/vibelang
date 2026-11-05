package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Minimized from the BrowserSession schema field in t3code.
func TestSchemaErrorContextualHoist(t *testing.T) {
	for _, codec := range []string{"Schema.instanceOf(Date)", "Schema.instanceOf<typeof RegExp, unknown>(RegExp)"} {
		source := "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", { cause: " + codec + " }) {}\nexport const acceptsUnknown: unknown extends typeof Failed.Iso[\"cause\"] ? true : false = true\n"
		got, result := fixedPipe(t, source)
		if !strings.Contains(got, "schema error Failed") {
			t.Fatalf("hoisted codec lost its checked input type:\n%s\n%+v", got, result.Refused)
		}
		program, file, _, _ := editorProgram(t, got)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source reports %s%d: %s\n%s", d.Source(), d.Code(), d.String(), got)
			}
		}
		if again, _ := fixedPipe(t, got); again != got {
			t.Errorf("repair is not idempotent:\n%s", again)
		}
	}
}
