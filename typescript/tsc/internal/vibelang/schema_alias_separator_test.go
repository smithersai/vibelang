package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-34 requires repair edits to retain the following statement, including
// when a fused identifier would resolve to a different, valid schema.
func TestSchemaAliasStatementSeparator(t *testing.T) {
	for _, gap := range []string{"", " ", "/* keep */", "\n"} {
		for _, tail := range []string{"value;", "export function after(){return value;}"} {
			t.Run(fmt.Sprintf("%q/%s", gap, tail), func(t *testing.T) {
				source := "import {Schema} from 'effect';const Base=Schema.String;const Basevalue=Schema.Number;const value=7;\nexport const X=Base;export type X=typeof X.Type;" + gap + tail + "\n"
				got := applyQuickFix(t, source, 4841)
				// Checking a new consumer after applying the editor edit detects a valid
				// Basevalue fusion, which a speculative no-new-errors gate cannot catch.
				program, file, _, _ := editorProgram(t, got+"\nexport const witness: X='ok';\n")
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("repair changed token boundaries: %s\n%s", d.String(), got)
					}
				}
				if !strings.Contains(got, gap+tail) {
					t.Errorf("following statement/comment lost: %s", got)
				}
			})
		}
	}
}
