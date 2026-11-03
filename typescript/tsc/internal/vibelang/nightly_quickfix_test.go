package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-34 and D372 require automatic repairs to remove their diagnostic
// without introducing another error. VIP-6 retires the capture diagnostic;
// the original nightly witness must not regain it or its unsafe input fix.
func TestNightlyQuickFixSafety(t *testing.T) {
	for _, test := range []struct {
		name, source, title string
		code                int32
	}{
		// "resource callback" (EK4301 on timer) retired with D67: TestRetiredHelperReturnTypeDiagnostics (VIP-1).
		{"unmatched input", "function size(r: { name: string }) { return try sync(() => r.name.length, r) }", "Pass r as an input", 4405},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Code() == test.code {
					t.Fatalf("VIP-6 permits lexical capture; retired diagnostic: %s", diagnosticWithNotes(diagnostic))
				}
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
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
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, test.title) {
							t.Fatalf("unsafe quick fix offered: %s", action.CodeAction.Title)
						}
					}
				}
			}
		})
	}
}
