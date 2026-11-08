package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// An unmarked callable whose body returns no Effect has no channels to
// write, and a written slot its returned Effect does not fit is refused.
func TestVIP3UnmarkedInferSlotRefusals(t *testing.T) {
	for _, source := range []string{
		"export function plain(): Effect.Effect<infer A> { return 1 as any }\n",
		"export function written(): Effect.Effect<string, infer E> { return Effect.succeed(1) }\n",
	} {
		program, file, service, converters := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() != diagnosticSource || d.Code() != EK4857.Code {
				continue
			}
			found = true
			pushed := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        pushed.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{pushed}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write ") {
						t.Errorf("offered %q for a slot it cannot preserve:\n%s", action.CodeAction.Title, source)
					}
				}
			}
		}
		if !found {
			t.Errorf("missing EK4857 in:\n%s", source)
		}
	}
}

func requireNoErrors(t *testing.T, stage, source string) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("%s output reports %s:\n%s", stage, d.String(), source)
		}
	}
}
