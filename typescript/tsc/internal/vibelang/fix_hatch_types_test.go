package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestLegacyHatchTypeEditorAction(t *testing.T) {
	assertLegacyHatchTypeEditorAction(t, "import * as R from \"vibelang-runtime\"\nconst run: typeof /* 😃 */ sync = R[\"sync\"]; export const value = run(7)\n", 2345, "typeof /* 😃 */ sync", "typeof /* 😃 */ import(\"vibelang-runtime\").sync")
}

func TestLegacyHatchTypeFactoryEditorAction(t *testing.T) {
	assertLegacyHatchTypeEditorAction(t, "import * as R from \"vibelang-runtime\"\nexport function factory(): typeof /* 😃 */ callback { return R[\"callback\"] }\n", 2322, "typeof /* 😃 */ callback", "typeof /* 😃 */ import(\"vibelang-runtime\").callback")
}

func assertLegacyHatchTypeEditorAction(t *testing.T, source string, code int32, query, replacement string) {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	for _, item := range program.GetSemanticDiagnostics(t.Context(), file) {
		if item.Code() != code {
			continue
		}
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, item)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray == nil {
			continue
		}
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction == nil || action.CodeAction.Title != legacyHatchTypeAction {
				continue
			}
			edits := (*action.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
			fixed := applyEditorEdits(t, file, converters, edits)
			want := strings.Replace(source, query, replacement, 1)
			if fixed != want {
				t.Fatalf("editor wrote:\n%s\nwant:\n%s", fixed, want)
			}
			if ds := errorsOf(t, fixed); len(ds) != 0 {
				t.Fatal(ds)
			}
			return
		}
	}
	t.Fatal("native argument error has no preserving editor action")
}
