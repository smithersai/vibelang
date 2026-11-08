package vibelang

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestConcurrentLimitCommaQuickFix(t *testing.T) {
	for _, limit := range []string{
		"mark(1), 1",
		"mark(1), mark(2), 1",
		"mark(1) /* π */, // keep\n 1",
		"(true ? mark(1) : mark(2)), 1",
	} {
		t.Run(limit, func(t *testing.T) {
			source := "function mark(n: number) { return n }\nexport effect function f() {\n for concurrent(" + limit + ") (const n of [1]) {}\n return 0\n}\n"
			want := strings.Replace(source, "concurrent("+limit+")", "concurrent(("+limit+"))", 1)
			program, file, service, converters := editorProgram(t, source)
			var chosen *lsproto.CodeAction
			for _, item := range program.GetSyntacticDiagnostics(t.Context(), file) {
				if item.Source() != "" || item.Code() != 1005 {
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
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && action.CodeAction.Title == "Parenthesize the comma expression used as a concurrent limit" {
							chosen = action.CodeAction
						}
					}
				}
			}
			if chosen == nil {
				t.Fatal("missing concurrent-limit syntax repair")
			}
			got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
			if got != want {
				t.Fatalf("quick fix wrote\n%s\nwant\n%s", got, want)
			}
			fixed, fixedFile, _, _ := editorProgram(t, got)
			if ds := fixed.GetSyntacticDiagnostics(t.Context(), fixedFile); len(ds) != 0 {
				t.Fatalf("fixed syntax reports %v", ds)
			}
			if ds := errorsOf(t, got); len(ds) != 0 {
				t.Fatalf("fixed source reports %v", ds)
			}
		})
	}
}

func TestConcurrentLimitCommaFixLeavesOtherCodes(t *testing.T) {
	for _, source := range []string{
		"export const value = (1;\n",
		"export effect function f() { Effect.runPromise(Effect.succeed(1)); return 0 }\n",
		"function mark(n: number) { return n }\nexport effect function f() { for concurrent((mark(1), 1)) (const n of [1]) {}; return 0 }\n",
	} {
		program, file, service, converters := editorProgram(t, source)
		all := slices.Concat(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file))
		for _, item := range all {
			if item.Code() != 1005 {
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
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && action.CodeAction.Title == "Parenthesize the comma expression used as a concurrent limit" {
						t.Fatalf("concurrent-limit repair offered for an unrelated diagnostic:\n%s", source)
					}
				}
			}
		}
	}
}
