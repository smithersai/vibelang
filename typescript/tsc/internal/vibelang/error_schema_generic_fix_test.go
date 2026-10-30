package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"testing"
)

func TestErrorTypeParameterSchemaRefusesInvalidClass(t *testing.T) {
	program, file, service, _ := editorProgram(t, "export schema error E<T> {}\n")
	found := false
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() != 1303 {
			continue
		}
		found = true
		actions, err := errorMemberClassFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: 1303, Program: program, LS: service})
		if err != nil {
			t.Fatal(err)
		}
		if len(actions) != 0 {
			t.Fatal("offered a class whose generic Schema Self introduces TS2562")
		}
	}
	if !found {
		t.Fatal("missing EK1303")
	}
}
