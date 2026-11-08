package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestModuleServiceShapeNamespace(t *testing.T) {
	program, file, _, _ := editorProgram(t, "export service Top { static readonly key = \"top\"; n: number }\nexport const top: Top.Shape = { n: 1 }\nnamespace N { export service Nested { static readonly key = \"nested\"; n: number }; const impl: Nested.Shape = { n: 2 } }\n")
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Error(d.String())
		}
	}
}

func TestLocalServiceShapeGenericFix(t *testing.T) {
	source := "export function f() {\n service S { static readonly key = \"local/generic\"; n: number }\n const value: S.Shape<number> = { n: 1 }\n return value\n}\n"
	program, file, service, converters := editorProgram(t, source)
	found := false
	for _, item := range program.GetSemanticDiagnostics(t.Context(), file) {
		if item.Code() != 2702 && item.Code() != 2503 {
			continue
		}
		found = true
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, item)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray != nil {
			for _, action := range *response.CommandOrCodeActionArray {
				if chosen := action.CodeAction; chosen != nil && chosen.Title == "Use Context.Service.Shape for the local service" {
					t.Fatal("a non-generic Shape replacement cannot preserve these type arguments")
				}
			}
		}
	}
	if !found {
		t.Fatal("missing local service namespace diagnostic")
	}
}
