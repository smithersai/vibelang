package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestCatchFlagRemovalDoesNotStrandSuspension(t *testing.T) {
	for _, test := range []struct {
		name, handler string
		wantAction    bool
	}{
		{"async-await", "async (e: number) => await Promise.resolve(e)", false},
		{"do-await", "async (e: number) => do { await Promise.resolve(e) }", false},
		{"async-function-await", "async function (e: number) { return await Promise.resolve(e) }", false},
		{"generator-yield", "function* (e: number) { yield e; return 7 }", false},
		{"async-generator", "async function* (e: number) { yield await Promise.resolve(e) }", false},
		{"async-value", "async (e: number) => 7", true},
		{"generator-return", "function* (e: number) { return 7 }", true},
		{"nested-async", "async (e: number) => { const f = async () => await Promise.resolve(e); return 7 }", true},
		{"nested-generator", "function* (e: number) { const f = function* () { yield e }; return 7 }", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import {Effect} from 'effect';export effect function main(){return Effect.fail(1) catch " + test.handler + "}"
			program, file, service, converters := editorProgram(t, source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 509 {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing malformed-handler diagnostic:\n%s", source)
			}
			item := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			actions, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: item.Range,
				Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{item}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			if actions.CommandOrCodeActionArray != nil {
				for _, action := range *actions.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write the handler as ") {
						chosen = action.CodeAction
					}
				}
			}
			if chosen == nil {
				if test.wantAction {
					t.Fatal("missing preserving keyword-removal action")
				}
				return
			}
			if chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatal("keyword-removal action has no source edit")
			}
			fixed := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[uri])
			after, next, _, _ := editorProgram(t, fixed)
			var errors []string
			for _, d := range append(after.GetSyntacticDiagnostics(t.Context(), next), after.GetSemanticDiagnostics(t.Context(), next)...) {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, d.String())
				}
			}
			if !test.wantAction {
				t.Fatalf("keyword removal strands native suspension; action=%s\nfixed=%s\nerrors=%v", chosen.Title, fixed, errors)
			}
			if len(errors) != 0 {
				t.Fatalf("preserving keyword removal must compile: %v\n%s", errors, fixed)
			}
		})
	}
}
