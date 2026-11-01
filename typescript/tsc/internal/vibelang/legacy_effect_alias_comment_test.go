package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// D260 and chapter007 require the migration to retain comments. Qualification
// edits only the old identifier when shorthand would discard an operand gap.
func TestLegacyEffectAliasCommentFix(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export type Value = Effect /* retained */ <number>", "export type Value = Effect.Effect /* retained */ <number>"},
		{"// café 😀\nexport type Value = Effect< // retained\nnumber>", "// café 😀\nexport type Value = Effect.Effect< // retained\nnumber>"},
	} {
		t.Run(test.source, func(t *testing.T) {
			got := applyQuickFix(t, test.source, 4856)
			if got != test.want {
				t.Fatalf("comment-preserving migration:\ngot: %s\nwant: %s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4856 || d.Category() == diagnostics.CategoryError {
					t.Errorf("repair did not preserve the contract: %s", d.String())
				}
			}
		})
	}
}
