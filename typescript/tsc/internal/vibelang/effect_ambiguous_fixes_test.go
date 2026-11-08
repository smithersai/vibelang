package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestAmbiguousEffectImportQuickFixes(t *testing.T) {
	for _, test := range []struct {
		name     string
		packages []string
	}{
		{"Model", []string{"effect/ai", "effect/schema"}},
		{"Prompt", []string{"effect/ai", "effect/cli"}},
		{"Utils", []string{"effect", "effect/rpc"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "// café 😀\nexport const value = " + test.name + "\n"
			program, file, service, converters := editorProgram(t, source)
			items := program.GetSemanticDiagnostics(t.Context(), file)
			if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != 1401 {
				t.Fatalf("want EK1401, got %v", items)
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
			for _, pkg := range test.packages {
				title := fmt.Sprintf("Import %s from %q", test.name, pkg)
				found := false
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						chosen := action.CodeAction
						if chosen == nil || chosen.Title != title {
							continue
						}
						found = true
						if chosen.Edit == nil || chosen.Edit.Changes == nil {
							t.Fatal("missing edit")
						}
						got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
						if want := fmt.Sprintf("import { %s } from %q\n", test.name, pkg) + source; got != want {
							t.Fatalf("got %q, want %q", got, want)
						}
						checked, edited, _, _ := editorProgram(t, got)
						for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
							if after.Category() == diagnostics.CategoryError {
								t.Errorf("quick fix left %s", after.String())
							}
						}
					}
				}
				if !found {
					t.Errorf("missing %s", title)
				}
			}
		})
	}
}
