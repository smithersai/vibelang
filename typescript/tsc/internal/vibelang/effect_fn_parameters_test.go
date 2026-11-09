package vibelang

import (
	"testing"
)

// An import type qualifies its own member; only its type arguments may use
// implicit names. Counting Brand as a written global makes inferred returns
// import the unrelated root namespace instead of preserving the import type.
func TestWrittenPreludeNamesImportTypes(t *testing.T) {
	for _, tc := range []struct {
		source, name string
		want         bool
	}{
		{"export const f = effect (x: import(\"effect/Brand\").Brand<\"Path\">) => x\n", "Brand", false},
		{"export const f = effect (x: import(\"effect/Effect\").Effect<number, never, Scope.Scope>) => x\n", "Scope", true},
	} {
		program, file, _, _ := editorProgram(t, tc.source)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		got := writtenPreludeNames(c, preludeStateOf(c), file)[tc.name]
		done()
		if got != tc.want {
			t.Errorf("%s written=%t, want %t in %s", tc.name, got, tc.want, tc.source)
		}
	}
}
