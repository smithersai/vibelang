package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-26: "There is no magic entry point." Even a client with a stale
// EK4843 diagnostic must not be offered a lexical-to-function rewrite.
func TestRetiredConstMainQuickFix(t *testing.T) {
	const source = "export const main = (): number => 7\n"
	program, file, service, converters := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 4843 {
			t.Errorf("retired EK4843 still reported: %s", d.String())
		}
	}
	if registry[4843] != nil || tsFormRules[4843] != nil {
		t.Error("retired EK4843 remains registered")
	}
	// An editor opened before a compiler upgrade may still send this code.
	start := strings.Index(source, "main")
	stale := ast.NewExternalDiagnostic(file, core.NewTextRange(start, start+4), diagnosticSource, diagnostics.CategoryWarning, 4843, "old entry warning")
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, stale)
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
			if action.CodeAction != nil && action.CodeAction.Edit != nil {
				t.Errorf("retired EK4843 still offers an edit: %s", action.CodeAction.Title)
			}
		}
	}
}
