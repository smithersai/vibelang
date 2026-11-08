package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

var escapedEffectRepairForms = []string{
	"export WORD function load() { return 1 }",
	"export const load = WORD (n: number) => n",
	"export class C { WORD load() { return 1 } }",
	"export const c = { WORD load() { return 1 } }",
	"export const load = WORD { return 1 }",
	"export const load = WORD function(n: number) { return n }",
}

func TestEscapedEffectKeywordEditorRepair(t *testing.T) {
	for _, word := range []string{`\u0065ffect`, `eff\u0065ct`, `\u{65}ffect`} {
		for _, form := range escapedEffectRepairForms {
			t.Run(word+"/"+form, func(t *testing.T) {
				const prefix = "const café = '😀';\n"
				source := prefix + strings.Replace(form, "WORD", word, 1)
				want := prefix + strings.Replace(form, "WORD", "effect", 1)
				program, file, service, converters := editorProgram(t, source)
				items := program.GetSyntacticDiagnostics(t.Context(), file)
				var actions []lsproto.CommandOrCodeAction
				for _, diagnostic := range items {
					if diagnostic.Code() != 1260 {
						continue
					}
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}}})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray != nil {
						actions = append(actions, (*response.CommandOrCodeActionArray)...)
					}
				}
				for _, item := range actions {
					if item.CodeAction == nil || item.CodeAction.Title != "Write the effect keyword without escapes" {
						continue
					}
					if item.CodeAction.Edit == nil {
						t.Fatal("keyword repair has no workspace edit")
					}
					changes := item.CodeAction.Edit.Changes
					if changes == nil {
						t.Fatal("keyword repair has no workspace edit")
					}
					got := applyEditorEdits(t, file, converters, (*changes)[lsconv.FileNameToDocumentURI(file.FileName())])
					if got != want {
						t.Fatalf("keyword repair changed other source:\ngot %s\nwant %s", got, want)
					}
					return
				}
				t.Fatal("no escaped effect keyword repair")
			})
		}
	}
}

func TestEscapedEffectOrdinaryIdentifiersStayWritten(t *testing.T) {
	for _, source := range []string{
		`export const \u0065ffect = 1`,
		`export class C { \u0065ffect() { return 1 } }`,
	} {
		_, file, _, _ := editorProgram(t, source)
		if p := file.Diagnostics(); len(p) != 0 {
			t.Fatal(p)
		}
	}
}
