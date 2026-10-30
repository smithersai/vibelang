package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-34 and D372 require automatic repairs to remove their diagnostic
// without introducing another error. These are minimized nightly witnesses.
func TestNightlyQuickFixSafety(t *testing.T) {
	for _, test := range []struct {
		name, source, title string
		code                int32
	}{
		{"resource callback", "function timer(name: string) { return { name, [Symbol.dispose]() {} } }\nexport function names(ids: string[]) { return ids.map((id) => { using t = timer(id); return t.name }) }", "Write the return type of timer:", EK4301.Code},
		{"unmatched input", "function size(r: { name: string }) { return try sync(() => r.name.length, r) }", "Pass r as an input", EK4405.Code},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, test.source)
			found := false
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Code() != test.code {
					continue
				}
				found = true
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
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, test.title) {
							t.Fatalf("unsafe quick fix offered: %s", action.CodeAction.Title)
						}
					}
				}
			}
			if !found {
				t.Fatalf("missing EK%d", test.code)
			}
		})
	}
}
