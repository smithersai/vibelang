package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3 static rules: a member gets one diagnostic, the first row that
// names it. A _tag property with a modifier is the EK2117 row's, with none of
// the generated class's TypeScript errors (TS2415, TS2564, TS2612).
func TestErrorReservedTagModifiersReportOnce(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{
			`private _tag: "E"`,
			`protected _tag: "E"`,
			`private readonly _tag: "E"`,
			`public _tag: string`,
			`declare _tag: "E"`,
			`_tag!: "E"`,
			`accessor _tag = "E"`,
		} {
			t.Run(form+" "+member, func(t *testing.T) {
				source := "export " + form + " E { id: string; " + member + " }\n"
				program, file, _, _ := editorProgram(t, source)
				var errors []string
				reserved := -1
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					errors = append(errors, d.String())
					if d.Code() == 2117 && d.Source() == diagnosticSource {
						reserved = d.Pos()
					}
				}
				if at := strings.Index(source, "_tag"); len(errors) != 1 || reserved != at {
					t.Fatalf("want one EK2117 at the _tag name (%d), got %v", at, errors)
				}
			})
		}
	}
}

// Covering TS2415 at the class name must not hide an independent error that
// the same declaration reports elsewhere.
func TestErrorReservedTagModifiersKeepIndependentErrors(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export error E { private _tag: \"E\"; id: Missing }\n")
	var reserved, unknown bool
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		reserved = reserved || d.Code() == 2117
		unknown = unknown || d.Code() == 2304
	}
	if !reserved || !unknown {
		t.Fatalf("reserved=%v independent TS2304=%v", reserved, unknown)
	}
}
