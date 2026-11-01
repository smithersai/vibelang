package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-1/VIP-5: an effect-body await is EK0102; its repair must stay in
// effect code and wait for the handle rather than introduce another error.
func TestAwaitPlacementQuickFixes(t *testing.T) {
	for _, handle := range []struct{ name, typ, title string }{
		{"fiber", "Fiber.Fiber<number>", "Join the fiber with join"},
		{"deferred", "Deferred.Deferred<number>", "Wait for the Deferred with try Deferred.await"},
	} {
		operands := []string{"value", "(value)", "box.value", "(flag ? value : other)", "get()", "/* wait 😀 */ value"}
		if handle.name == "fiber" {
			operands = append(operands, "[value, other]", "({ left: value, right: other })")
		}
		for i, operand := range operands {
			t.Run(fmt.Sprintf("%s/%d", handle.name, i), func(t *testing.T) {
				source := "import type { Fiber, Deferred } from \"effect\"\n" +
					"declare const value: " + handle.typ + "\n" +
					"declare const other: " + handle.typ + "\n" +
					"declare const box: { value: " + handle.typ + " }\n" +
					"declare const flag: boolean\n" +
					"/** @throws {never} */ declare function get(): " + handle.typ + "\n" +
					"export effect function wait() { /* café 😀 */ return await " + operand + " }\n"
				program, file, service, converters := editorProgram(t, source)
				var placement *ast.Diagnostic
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == EK0102.Code {
						placement = d
						break
					}
				}
				if placement == nil {
					t.Fatal("missing EK0102")
				}
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, placement)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				var repairs []*lsproto.CodeAction
				if response.CommandOrCodeActionArray != nil {
					for _, item := range *response.CommandOrCodeActionArray {
						action := item.CodeAction
						if action != nil && (strings.HasPrefix(action.Title, "Join the fiber") || strings.HasPrefix(action.Title, "Wait for the Deferred")) {
							repairs = append(repairs, action)
						}
					}
				}
				if len(repairs) != 1 || repairs[0].Title != handle.title {
					t.Fatalf("want only %q; got %v", handle.title, repairs)
				}
				if repairs[0].Edit == nil || repairs[0].Edit.Changes == nil {
					t.Fatal("missing edit")
				}
				fixed := applyEditorEdits(t, file, converters, (*repairs[0].Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
				for _, comment := range []string{"/* café 😀 */", "/* wait 😀 */"} {
					if strings.Count(fixed, comment) != strings.Count(source, comment) {
						t.Fatalf("comment lost: %s", fixed)
					}
				}
				resultType := "number"
				if handle.name == "fiber" && i == 6 {
					resultType = "number[]"
				} else if handle.name == "fiber" && i == 7 {
					resultType = "{ left: number; right: number }"
				}
				// A repair must return the completion value, not an unrun nested Effect.
				checked, edited, _, _ := editorProgram(t, fixed+"\nconst completion: "+resultType+"!! = wait()\n")
				for _, after := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
					if after.Category() == diagnostics.CategoryError {
						t.Errorf("repair adds %s\n%s", after.String(), fixed)
					}
				}
			})
		}
	}
}
