package vibelang

import "testing"

// The tag row precedes static members and setters; it owns these members.
func TestErrorStaticTagRouting(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{"static readonly _tag = \"E\"", "static get _tag() { return \"E\" }"} {
			source := form + " E { " + member + " }"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 1302 {
					t.Errorf("static rule also claimed the tag member: %s", source)
				}
			}
		}
	}
}
