package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestEffectShorthandOwningDiagnostic(t *testing.T) {
	for _, source := range []string{
		"effect load() {}",
		"async load() {}",
		"export effect /* keep */ load<T>(n: T) { return n }",
		"export async /* keep */ load<T>(n: T) { return n }",
		"function outer() { effect load() {} }",
		"function outer() { async load() {} }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			var owning *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 4618 {
					t.Errorf("retired shorthand diagnostic: %s", d.String())
				}
				if d.Source() == "EK" && d.Code() == 101 {
					owning = d
				}
			}
			if owning == nil {
				t.Fatal("missing VIP-1 owning diagnostic EK0101")
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, owning)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			want := strings.Replace(source, "load", "function load", 1)
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction == nil || action.CodeAction.Edit == nil || action.CodeAction.Edit.Changes == nil {
						continue
					}
					changes := *action.CodeAction.Edit.Changes
					got := applyEditorEdits(t, file, converters, changes[lsconv.FileNameToDocumentURI(file.FileName())])
					if got == want {
						if errors := errorsOf(t, got); len(errors) != 0 {
							t.Fatalf("repaired source: %v", errors)
						}
						return
					}
				}
			}
			t.Fatalf("EK0101 has no insertion-only quick fix yielding %q", want)
		})
	}
}
