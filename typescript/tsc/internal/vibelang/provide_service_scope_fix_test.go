package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const provideServiceScopeSource = `service Key {
 static readonly key = "fix-scope/Key"
 value: number
}
effect function observe(): string!! {
 const memo = try Effect.serviceOption(Layer.CurrentMemoMap)
 return memo._tag
}
export function main() {
 return Effect.provideService(observe(), Key, { value: 1 })
}
`

// The native call sees no Layer memo map; the former block rewrite sees Some.
// VIP-34's meaning-preservation rule requires an explanation without edits.
func TestProvideServiceScopeHasNoQuickFix(t *testing.T) {
	program, file, service, converters := editorProgram(t, provideServiceScopeSource)
	var found *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("fixture rejected: %s", d.String())
		}
		if d.Source() == diagnosticSource && d.Code() == 4836 {
			found = d
		}
	}
	if found == nil {
		t.Fatal("missing EK4836 explanation")
	}
	text := diagnosticWithNotes(found)
	if !strings.Contains(text, "No quick fix") || !strings.Contains(text, "Layer.CurrentMemoMap") {
		t.Fatalf("missing native scope explanation: %s", text)
	}
	diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, found)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        diagnostic.Range,
		Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction != nil && action.CodeAction.Edit != nil {
				t.Fatalf("unsafe provideService editor rewrite offered: %s", action.CodeAction.Title)
			}
		}
	}
}
