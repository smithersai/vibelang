package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-5: the repair stays in async code and returns the completion value.
func TestNativeAwaitQuickFixBridge(t *testing.T) {
	for _, handle := range []struct {
		name, typ string
		code      int32
	}{
		{"fiber", "Fiber.Fiber<number>", 4609}, {"deferred", "Deferred.Deferred<number>", 4610},
	} {
		for _, operand := range []string{"value", "(value)", "box.value", "(flag ? value : other)", "get()", "/* wait 😀 */ value"} {
			t.Run(handle.name+"/"+operand, func(t *testing.T) {
				source := "import type {Fiber, Deferred} from 'effect';\n" +
					"declare const value: " + handle.typ + "; declare const other: " + handle.typ + ";\n" +
					"declare const box: {value: " + handle.typ + "}; declare const flag: boolean;\n" +
					"declare function get(): " + handle.typ + ";\n" +
					"export async function probe(Effect = 0, Fiber = 0, Deferred = 0, runPromise = 0, $awaitRunPromise = 0, $awaitJoin = 0, $awaitDeferred = 0) { /* café 😀 */ return await " + operand + " }\n"
				program, file, service, converters := editorProgram(t, source)
				count := 0
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Source() != diagnosticSource || diagnostic.Code() != handle.code {
						continue
					}
					count++
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
						Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
					})
					if err != nil {
						t.Fatal(err)
					}
					repairs := 0
					if response.CommandOrCodeActionArray != nil {
						for _, item := range *response.CommandOrCodeActionArray {
							action := item.CodeAction
							if action == nil || action.Edit == nil || action.Edit.Changes == nil {
								continue
							}
							repairs++
							fixed := applyEditorEdits(t, file, converters, (*action.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
							for _, comment := range []string{"/* café 😀 */", "/* wait 😀 */"} {
								if strings.Count(fixed, comment) != strings.Count(source, comment) {
									t.Fatalf("lost comment: %s", fixed)
								}
							}
							checked, edited, _, _ := editorProgram(t, fixed+"\nconst completion: Promise<number> = probe();\n")
							for _, after := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
								if after.Category() == diagnostics.CategoryError || after.Source() == diagnosticSource && (after.Code() == 4609 || after.Code() == 4610) {
									t.Errorf("repair adds %s\n%s", after.String(), fixed)
								}
							}
						}
					}
					if repairs != 1 {
						t.Errorf("want one bridge repair, got %d", repairs)
					}
				}
				if count != 1 {
					t.Fatalf("want one EK%d, got %d", handle.code, count)
				}
			})
		}
	}
}

// Same-kind unions still warn, but a generic bridge must accept the whole
// union before an automatic edit is safe.
func TestNativeAwaitQuickFixUnion(t *testing.T) {
	for _, test := range []struct{ name, typ, parameters string }{
		{"fiber", "Fiber.Fiber<number>|Fiber.Fiber<string>", ""},
		{"deferred", "Deferred.Deferred<number>|Deferred.Deferred<string>", ""},
		{"generic-fiber", "T", "<T extends Fiber.Fiber<number>|Fiber.Fiber<string>>"},
		{"generic-fiber-intersection", "T & {readonly extra?: 1}", "<T extends Fiber.Fiber<number>|Fiber.Fiber<string>>"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import type {Fiber,Deferred} from 'effect'; export async function probe" + test.parameters + "(value:" + test.typ + "){return await value}"
			program, file, service, converters := editorProgram(t, source)
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Source() != diagnosticSource || diagnostic.Code() != 4609 && diagnostic.Code() != 4610 {
					continue
				}
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only}})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray == nil {
					return
				}
				for _, item := range *response.CommandOrCodeActionArray {
					if item.CodeAction == nil || item.CodeAction.Edit == nil || item.CodeAction.Edit.Changes == nil {
						continue
					}
					fixed := applyEditorEdits(t, file, converters, (*item.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
					checked, edited, _, _ := editorProgram(t, fixed+"\nconst completion:Promise<number|string> = probe(null!);")
					for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
						if after.Category() == diagnostics.CategoryError {
							t.Errorf("unsafe union repair: %s\n%s", after.String(), fixed)
						}
					}
				}
			}
		})
	}
}
