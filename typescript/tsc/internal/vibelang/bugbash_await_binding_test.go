package vibelang

import "testing"

func TestBugBashAwaitBinding(t *testing.T) {
	for _, source := range []string{
		"export function f(await: number) { return 1 }",
		"export const f = (await: number) => 1",
		"export const f = (await, b: number) => b",
		"export const f = (await?: number) => 1",
		"export function f({x: await}: {x: number}) { return 1 }",
	} {
		p, file, _, _ := editorProgram(t, source)
		found := false
		for _, d := range p.GetSyntacticDiagnostics(t.Context(), file) {
			if d.Code() == 1359 {
				found = true
			}
		}
		if !found {
			t.Errorf("missing reserved binding diagnostic for %s", source)
		}
	}
}
