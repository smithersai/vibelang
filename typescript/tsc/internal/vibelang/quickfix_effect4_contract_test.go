package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestQuickFixRefusesChangedEffect4Contracts(t *testing.T) {
	for name, change := range effect3API {
		if change.note == "" {
			continue
		}
		for _, eol := range []string{"\n", "\r\n"} {
			t.Run(fmt.Sprintf("%s/%q", name, eol), func(t *testing.T) {
				source := "// preserved 😀" + eol + "export function main(){return typeof Effect." + name + "}" + eol
				program, file, service, converters := editorProgram(t, source)
				found := false
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Code() != 4813 {
						continue
					}
					found = true
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only}})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray != nil {
						for _, item := range *response.CommandOrCodeActionArray {
							if a := item.CodeAction; a != nil && a.Edit != nil {
								t.Errorf("offered contract-changing rename: %s", a.Title)
							}
						}
					}
					if !strings.Contains(notesOf(diagnostic), "No automatic fix") {
						t.Error("missing manual repair explanation")
					}
				}
				if !found {
					t.Fatal("missing EK4813")
				}
				if got := fileFixes(t.Context(), program, file, nil, []int32{4813}).text(); got != source {
					t.Errorf("CLI planned a contract change: %s", got)
				}
			})
		}
	}
}
