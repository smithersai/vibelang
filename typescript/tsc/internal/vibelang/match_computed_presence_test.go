package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-7's MatchProperty admits PropertyName with or without a colon.
func TestMatchComputedPresence(t *testing.T) {
	for _, key := range []string{`"field"`, "'field'", "1", "key", "names.field", "symbol"} {
		for _, source := range []string{
			"const key='field';const names={field:'field'};const symbol=Symbol.for('field');function f(x:unknown){return match(x){when {[" + key + "]}:1;default:0;}}",
			"const key='field';const names={field:'field'};const symbol=Symbol.for('field');function f(x:unknown){return x is {[" + key + "]}}",
		} {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("computed presence rejected: %s: %s", source, d.String())
				}
			}
		}
	}
}
