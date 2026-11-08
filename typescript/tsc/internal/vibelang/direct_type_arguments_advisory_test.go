package vibelang

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestDirectTypeArgumentsAdvisory(t *testing.T) {
	for _, api := range []string{"succeed", "fail"} {
		types, value := []string{"number", "unknown", "number | string"}, "1"
		if api == "fail" {
			types, value = []string{"string", "unknown", "string | number"}, "\"no\""
		}
		for _, typ := range types {
			for _, alias := range []bool{false, true} {
				prefix, callee := "", "Effect."+api
				if alias {
					prefix = "import {" + api + " as supplied} from \"effect/Effect\";"
					callee = "supplied"
				}
				call := callee + "<" + typ + ">(" + value + ")"
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/%s/alias=%t/%s", api, typ, alias, style), func(t *testing.T) {
						body := "return try " + call
						switch style {
						case "parenthesized":
							body = "return try (" + call + ")"
						case "nonnull":
							body = "return try " + call + "!"
						case "stored":
							body = "const stored=" + call + ";return try stored"
						}
						program, file, _, _ := editorProgram(t, prefix+"export effect function f(){"+body+"}")
						count := 0
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == 4834 {
								count++
								if !strings.Contains(diagnosticWithNotes(d), "explicit type arguments") {
									t.Fatalf("missing written-contract explanation: %s", diagnosticWithNotes(d))
								}
							}
						}
						want := 1
						if style == "stored" {
							want = 0
						}
						if count != want {
							t.Fatalf("want %d EK4834, got %d", want, count)
						}
					})
				}
			}
		}
	}
}

func TestDirectTypeArgumentsAdvisoryPreservesContract(t *testing.T) {
	for _, api := range []string{"succeed", "fail"} {
		t.Run(api, func(t *testing.T) {
			source := "export effect function f(){return try Effect." + api + "<unknown>(1)}"
			program, file, service, converters := editorProgram(t, source)
			var found *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 4834 {
					found = d
				}
			}
			if found == nil {
				t.Fatal("missing EK4834")
			}
			if !strings.Contains(diagnosticWithNotes(found), "No quick fix") {
				t.Fatalf("missing refusal: %s", diagnosticWithNotes(found))
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
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil && a.CodeAction.Edit != nil {
						t.Fatalf("type contract rewrite offered: %s", a.CodeAction.Title)
					}
				}
			}
			fixed := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed.Err != nil || len(fixed.Files) != 0 {
				t.Fatalf("explicit contract rewritten: %+v", fixed)
			}

		})
	}
}
