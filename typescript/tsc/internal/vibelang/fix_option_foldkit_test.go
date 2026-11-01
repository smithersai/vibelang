package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestOptionFactoryHoistFoldkit(t *testing.T) {
	for _, source := range []string{
		"function fallback(): () => number { return (): number => 0 }\nexport const f = (v:Option.Option<number>):number => pipe(v, Option.map((n:number):number => n + 1), Option.getOrElse(fallback()))",
		"function make(): (n: number) => number { return (n:number):number => n + 1 }\nexport const f = (v:Option.Option<number>):Option.Option<number> => pipe(v, Option.map(make()))",
		"function make(): (n: number) => number { return (n:number):number => n + 1 }\nexport const f = (v:Option.Option<number>):number => pipe(v, Option.map(make()), Option.getOrElse(() => 0))",
		"function make(): (n: number) => number { return (n:number):number => n + 1 }\nexport const f = (v:Option.Option<number>):Option.Option<number> => v.pipe(Option.map(make()), Option.map((n:number) => n * 2))",
		"function make(): (n: number) => number { return (n:number):number => n + 1 }\nexport const f = (v:Option.Option<number>):Option.Option<number> => { const $optionInput = 9; return pipe(v, Option.map(make()), Option.map((n:number) => n + $optionInput)) }",
	} {
		fixed := applyQuickFix(t, source, EK4840.Code)
		if strings.Contains(fixed, "Option.map") || !strings.Contains(fixed, "do {") {
			t.Fatalf("no factory hoist quick fix:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s\n%s", d.String(), fixed)
			}
		}
	}
}
