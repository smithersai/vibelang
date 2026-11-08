package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestAwaitEffectValueQuickFix(t *testing.T) {
	for _, form := range []string{"export async function values() {return %s}", "export async function* values():AsyncGenerator<Effect.Effect<number>,void,unknown> {yield %s}", "export const values=async function* ():AsyncIterable<Effect.Effect<number>> {yield %s}", "export class Feed {async *values():AsyncGenerator<Effect.Effect<number>,void,unknown> {yield %s}}"} {
		for _, operand := range []string{"value", "(value)", "/* retained 😀 */ (flag ? value : other)"} {
			t.Run(form+operand, func(t *testing.T) {
				source := "import type {Effect} from \"effect\"; declare const value:Effect.Effect<number>; declare const other:Effect.Effect<number>; declare const flag:boolean; const Promise=0,runPromise=0,$value=0; " + fmt.Sprintf(form, "await "+operand)
				program, file, service, converters := editorProgram(t, source)
				fixes := 0
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Source() != diagnosticSource || diagnostic.Code() != EK0103.Code {
						continue
					}
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
						action := item.CodeAction
						if action == nil || action.Title != awaitEffectValueFixTitle || action.Edit == nil || action.Edit.Changes == nil {
							continue
						}
						fixes++
						fixed := applyEditorEdits(t, file, converters, (*action.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
						if strings.Count(fixed, "/* retained 😀 */") != strings.Count(source, "/* retained 😀 */") {
							t.Fatalf("lost comment: %s", fixed)
						}
						checked, edited, _, _ := editorProgram(t, fixed)
						for _, after := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
							if after.Category() == diagnostics.CategoryError {
								t.Errorf("%s\n%s", after.String(), fixed)
							}
						}
					}
				}
				if fixes != 1 {
					t.Fatalf("expected one preserving repair, got %d", fixes)
				}
			})
		}
	}
}
