package vibelang

import "testing"

func TestConstructorFiberTypesWithoutPrelude(t *testing.T) {
	source := "import {AsyncFiberError as Imported} from \"effect/Cause\"\nexport const ctor=Imported\n"
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	if tx := newConstructorFiberTypes(c, file); tx == nil {
		t.Fatal("inferred SDK constructor types must import Fiber even when the source never loads its prelude binding")
	}
}
