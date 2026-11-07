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

// Appendix B: under VIP-26 an exported lexical main, const or let, keeps its
// ordinary binding: the compiler reports no VibeLang diagnostic for it, and
// the editor offers no declaration-changing edit, even for a stale
// entry-warning diagnostic.
// Appendix B: exported lexical main — spec-rule: docs/design/src/900-appendices.md#1a364bf0ee9203f5
func TestExportedLexicalMainKeepsItsBinding(t *testing.T) {
	for _, source := range []string{
		"export const main = effect () => { return 7 }\n",
		"export let main = effect () => { return 7 }\n",
		"export const main = (): number => 7\n",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource {
					t.Errorf("unexpected VibeLang diagnostic: %s", d.String())
				}
			}
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
						t.Errorf("an edit is offered for main: %s", action.CodeAction.Title)
					}
				}
			}
		})
	}
}
