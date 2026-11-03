package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"os"
	"strings"
	"testing"
)

// Chapter 002: catch execution heads have a mechanical, caller-side quick fix.
// docs/design/src/002-running.md#4b2763dda56abc3d
// docs/design/src/002-running.md#f6b6b49ab7a42b46
//
//gate:spec-tests
func TestCoverageRunningCatchQuickfix(t *testing.T) {
	if os.Getenv("VIBELANG_COVERAGE_PROBE") == "" {
		t.Skip("Chapter 002 pending: docs/design/src/002-running.md#" + "4b2763dda56abc3d" + " and docs/design/src/002-running.md#f6b6b49ab7a42b46; EK0505 and the LSP fixes are missing. Set VIBELANG_COVERAGE_PROBE=1 to run the witness.")
	}
	for _, test := range []struct{ name, source, fragment string }{
		{"join", "export effect function invalid(f: Fiber.Fiber<number, string>) { return join f catch () => 0 }", "Fiber.join(f) catch"},
		{"fork", "export effect function invalid(e: Effect.Effect<number, string>) { const f = fork e catch () => 0; return join f }", "fork Effect.catch(e,"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == EK0505.Code {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing EK0505 in %s", test.source)
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction == nil || action.CodeAction.Edit == nil || action.CodeAction.Edit.Changes == nil {
						continue
					}
					edits := (*action.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
					got := applyEditorEdits(t, file, converters, edits)
					compact := strings.Join(strings.Fields(got), " ")
					if strings.Contains(compact, test.fragment) {
						if strings.Contains(compact, "fork effect") {
							t.Fatal("quick fix deferred caller-side operand evaluation")
						}
						return
					}
				}
			}
			t.Fatalf("no EK0505 quick fix produced %q", test.fragment)
		})
	}
}
