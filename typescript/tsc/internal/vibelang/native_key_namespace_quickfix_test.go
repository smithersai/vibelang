package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestNativeServiceKeyNamespaceQuickFixes(t *testing.T) {
	const key = `class Key extends Context.Service<Key,{value:number}>()("native/Key"){};`
	for _, row := range []struct {
		name, source, old string
		want              bool
	}{
		{"direct", key + `export type Impl=Key.Shape`, "Key.Shape", true},
		{"qualified", `namespace Tags{export ` + key + `} export type Impl=Tags.Key.Shape`, "Tags.Key.Shape", true},
		{"ordinary", `class Key{};export type Impl=Key.Shape`, "Key.Shape", false},
		{"arguments", key + `export type Impl=Key.Shape<number>`, "Key.Shape", false},
		{"shadow", key + `function scope<Key>(){type Impl=Key.Shape}`, "Key.Shape", false},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := `import {Context} from "effect";` + row.source
			p, file, service, converters := editorProgram(t, source)
			found, diagnosed := false, false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() != 2702 && d.Code() != 2713 {
					t.Fatalf("unexpected %s", d.String())
				}
				diagnosed = true
				diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray == nil {
					continue
				}
				for _, action := range *response.CommandOrCodeActionArray {
					chosen := action.CodeAction
					if chosen == nil || chosen.Title != "Use Context.Service.Shape for the service key" {
						continue
					}
					found = true
					if !row.want {
						t.Fatal("unsafe native-key shape quick fix")
					}
					qualifier := strings.TrimSuffix(row.old, ".Shape")
					want := strings.ReplaceAll(source, row.old, `import("effect/Context").Service.Shape<typeof `+qualifier+">")
					got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
					if got != want {
						t.Fatalf("got %s, want %s", got, want)
					}
				}
			}
			if !diagnosed || found != row.want {
				t.Fatalf("diagnosed=%v offered=%v want=%v", diagnosed, found, row.want)
			}
		})
	}
}
