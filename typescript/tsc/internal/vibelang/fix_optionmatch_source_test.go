package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestOptionMatchSourceTypes(t *testing.T) {
	fields := []string{}
	for i := 0; i < 40; i++ {
		fields = append(fields, fmt.Sprintf("p%d: number", i))
	}
	for _, source := range []string{
		"export const formatDate = (date: string): string => Option.match(DateTime.make(date), {onNone: ():string => date, onSome: (time):string => DateTime.toDateUtc(time).toUTCString()})",
		"import {DateTime as DT, Option as O} from 'effect'; export const formatDate = (date:string):string => O.match(DT.make(date),{onNone:():string=>date,onSome:(time):string=>DT.toDateUtc(time).toUTCString()})",
		"export const pick = (value:Option.Option<{" + strings.Join(fields, ";") + "}>):number => Option.match(value,{onNone:():number=>0,onSome:(value):number=>value.p39})",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s\n%s", d.String(), fixed)
			}
		}
	}
}
