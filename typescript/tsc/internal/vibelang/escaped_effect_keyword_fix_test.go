package vibelang

import (
	"testing"
)

var escapedEffectRepairForms = []string{
	"export WORD function load() { return 1 }",
	"export const load = WORD (n: number) => n",
	"export class C { WORD load() { return 1 } }",
	"export const c = { WORD load() { return 1 } }",
	"export const load = WORD { return 1 }",
	"export const load = WORD function(n: number) { return n }",
}

func TestEscapedEffectOrdinaryIdentifiersStayWritten(t *testing.T) {
	for _, source := range []string{
		`export const \u0065ffect = 1`,
		`export class C { \u0065ffect() { return 1 } }`,
	} {
		_, file, _, _ := editorProgram(t, source)
		if p := file.Diagnostics(); len(p) != 0 {
			t.Fatal(p)
		}
	}
}
