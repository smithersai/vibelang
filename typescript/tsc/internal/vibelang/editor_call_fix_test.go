package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// TestEditorCallFixKeepsTheContract checks that a written broad contract
// does not permit running returned data. Both successful and failed Exit
// values belong to the caller; executing them would change its result.
func TestEditorCallFixKeepsTheContract(t *testing.T) {
	for _, test := range []struct {
		name, source string
		offered      bool
	}{
		{"a failure the contract rejects", "import * as Exit from \"effect/Exit\"\neffect function broad(): unknown!! { return Exit.fail(\"data\") }\n", false},
		{"a success still returned as data", "import * as Exit from \"effect/Exit\"\neffect function broad(): unknown!! { return Exit.succeed(4) }\n", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4802.Code {
					t.Fatalf("returned data reports own EK4802: %s", d.String())
				}
			}
			if diagnostic == nil {
				start := strings.LastIndex(test.source, "Exit.")
				diagnostic = ast.NewExternalDiagnostic(file, core.NewTextRange(start, start+strings.Index(test.source[start:], " }")), diagnosticSource, diagnostics.CategoryWarning, 4802, "stale returned-program diagnostic")
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
			offered := false
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					offered = offered || action.CodeAction != nil && action.CodeAction.Title == "Run it with try"
				}
			}
			if offered != test.offered {
				t.Fatalf("Run it with try offered: %v, want %v, in:\n%s", offered, test.offered, test.source)
			}
		})
	}
}
