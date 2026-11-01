package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestOptionMatchNativeFoldkit(t *testing.T) {
	for _, source := range []string{
		"export const f = (v: Option.Option<number>): number => Option.match(v, {onNone: ():number => 0, onSome: (n):number => n})",
		"export const f = (v: Option.Option<{a:number}>): number => Option.match(v, {onNone: ():number => 0, onSome: ({a}):number => { if (a) return a; return 2 }})",
		"export const f = (v: Option.Option<number>): number => { const $optionSubject = 4; return Option.match(v, {onSome:(n):number => n + $optionSubject, onNone:():number => 0}) }",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Option.match") || !strings.Contains(fixed, "when Option.Some(let ") {
			t.Fatalf("no native Option fix:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s\n%s", d.String(), fixed)
			}
		}
	}
}
