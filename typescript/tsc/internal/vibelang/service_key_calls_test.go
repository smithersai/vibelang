package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestServiceKeyCallQuickFix(t *testing.T) {
	const source = "service Fn: (n: number) => number\nexport function f() { return Fn(3) }\n"
	program, file, service, converters := editorProgram(t, source)
	items := program.GetSemanticDiagnostics(t.Context(), file)
	if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != EK3007.Code {
		t.Fatalf("want one EK3007, got %v", items)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, items[0])
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
			chosen := action.CodeAction
			if chosen == nil || chosen.Title != "Call the service's implementation" {
				continue
			}
			if chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatal("missing edit")
			}
			got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
			if want := strings.Replace(source, "Fn(3)", "Fn()(3)", 1); got != want {
				t.Fatalf("got %s, want %s", got, want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
				if after.Category() == diagnostics.CategoryError {
					t.Errorf("quick fix left error: %s", after.String())
				}
			}
			return
		}
	}
	t.Fatal("missing service key call quick fix")
}
