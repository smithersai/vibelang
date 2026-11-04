package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestQuickFixKeepsExtractorBindings(t *testing.T) {
	for _, test := range []struct {
		pattern, body string
		bare          bool
	}{
		{"C(let n)", "n", false},
		{"C(let n)", "7", false},
		{"C(/* keep the capture */ let n)", "n", false},
		{"C(/* keep the empty list */)", "7", false},
		{"C /* keep the matcher */ ()", "7", false},
		{"C()", "7", true},
	} {
		for _, crlf := range []bool{false, true} {
			source := "class C{constructor(readonly n:number){}}\nexport function main(){return match(new C(7)){when " + test.pattern + ":" + test.body + ";default:0;}}\n"
			if crlf {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			t.Run(source, func(t *testing.T) {
				program, file, service, converters := editorProgram(t, source)
				found := false
				actions := 0
				bare := 0
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Code() != 704 {
						continue
					}
					found = true
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only}})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray == nil {
						continue
					}
					for _, item := range *response.CommandOrCodeActionArray {
						a := item.CodeAction
						if a == nil || a.Edit == nil || a.Edit.Changes == nil {
							continue
						}
						actions++
						if strings.Contains(a.Title, "without extracting") || a.Title == "Write the bare class test" {
							bare++
							if !test.bare {
								t.Errorf("repair discarded extractor captures or comments: %s", a.Title)
								continue
							}
						}
						edits := (*a.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
						after := applyEditorEdits(t, file, converters, edits)
						for _, comment := range []string{"/* keep the capture */", "/* keep the empty list */", "/* keep the matcher */"} {
							if strings.Contains(source, comment) && !strings.Contains(after, comment) {
								t.Errorf("repair deleted %s", comment)
							}
						}
						fixed, fixedFile, _, _ := editorProgram(t, after)
						if ds := fixed.GetSemanticDiagnostics(t.Context(), fixedFile); len(ds) != 0 {
							t.Errorf("repair introduced diagnostics: %v", ds)
						}
					}
				}
				if !found {
					t.Fatal("missing EK0704 witness")
				}
				if test.bare && bare == 0 {
					t.Error("empty-list class test must remain available")
				}
				if strings.Contains(test.pattern, "let n") && actions == 0 {
					t.Error("preserving property extraction must remain available")
				}
			})
		}
	}
}
