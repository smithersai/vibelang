package vibelang

import "testing"

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
