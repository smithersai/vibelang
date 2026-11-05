package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestEffectExtraSlotQuickFix(t *testing.T) {
	for _, source := range []string{"export type X = number!!string!boolean", "// café 😀\nexport type X = number!!string /* channel */ !boolean"} {
		t.Run(source, func(t *testing.T) {
			p, file, service, converters := editorProgram(t, source)
			var diagnostic *ast.Diagnostic
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Source() == "EK" && d.Code() == 302 {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatal("missing EK0302")
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
			fixed := ""
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil && strings.HasPrefix(a.CodeAction.Title, "Write an explicitly nested") && a.CodeAction.Edit != nil && a.CodeAction.Edit.Changes != nil {
						fixed = applyEditorEdits(t, file, converters, (*a.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
					}
				}
			}
			want := strings.Replace(source, "number!!string", "(number!!string)", 1)
			if fixed != want {
				t.Fatalf("fix %q want %q", fixed, want)
			}
			checked, next, _, _ := editorProgram(t, fixed)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed type: %v", d)
				}
			}
		})
	}
}
