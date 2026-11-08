package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"path/filepath"
	"strings"
	"testing"
)

func optionalDirectFormSource(api string, chain int, style string, alias bool) string {
	prefix := "type Tagged={readonly _tag:\"Oops\"};service S{static readonly key=\"advisory/Optional\";value:number};"
	ns := "Effect"
	if alias {
		prefix = "import {Effect as Library} from \"effect\";" + prefix
		ns = "Library"
	}
	callee := ns + "." + api
	switch chain {
	case 0:
		callee += "?."
	case 1:
		callee = ns + "?." + api
	case 2:
		callee = ns + "?." + api + "?."
	}
	args := "1"
	switch api {
	case "catch":
		args = "e,h"
	case "catchTag":
		args = "e,\"Oops\",h"
	case "catchTags":
		args = "e,{Oops:h}"
	case "provide":
		args = "e,Layer.succeed(S,{value:1})"
	case "provideService":
		args = "e,S,{value:1}"
	}
	call := callee + "(" + args + ")"
	body := "return try " + call
	switch style {
	case "parenthesized":
		body = "return try (" + call + ")"
	case "nonnull":
		body = "return try (" + call + ")!"
	case "stored":
		body = "const stored=" + call + ";return try stored"
	}
	return prefix + "export effect function f(e:number!Tagged!S,h:(x:Tagged)=>number!!){" + body + "}"
}
func optionalDirectFormCode(api string) int32 {
	switch api {
	case "succeed", "fail":
		return 4834
	case "catch", "catchTag", "catchTags":
		return 4835
	}
	return 4836
}
func TestOptionalDirectFormAdvisories(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		for chain := range 3 {
			for _, alias := range []bool{false, true} {
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/chain%d/alias%t/%s", api, chain, alias, style), func(t *testing.T) {
						p, file, _, _ := editorProgram(t, optionalDirectFormSource(api, chain, style, alias))
						count := 0
						for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == optionalDirectFormCode(api) {
								count++
								if !strings.Contains(diagnosticWithNotes(d), "optional chaining") {
									t.Fatalf("missing optional-call explanation: %s", diagnosticWithNotes(d))
								}
							}
						}
						want := 1
						if style == "stored" {
							want = 0
						}
						if count != want {
							t.Fatalf("want %d advisory, got %d", want, count)
						}
					})
				}
			}
		}
	}
}
func TestOptionalDirectFormAdvisoriesPreserveCalls(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		t.Run(api, func(t *testing.T) {
			p, file, service, converters := editorProgram(t, optionalDirectFormSource(api, 0, "direct", false))
			var found *ast.Diagnostic
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == optionalDirectFormCode(api) {
					found = d
				}
			}
			if found == nil {
				t.Fatal("missing advisory")
			}
			if !strings.Contains(diagnosticWithNotes(found), "No quick fix") {
				t.Fatalf("missing refusal: %s", diagnosticWithNotes(found))
			}
			diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, found)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only}})
			if err != nil {
				t.Fatal(err)
			}
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil && a.CodeAction.Edit != nil {
						t.Fatalf("optional call rewrite offered: %s", a.CodeAction.Title)
					}
				}
			}
			fixed := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed.Err != nil || len(fixed.Files) != 0 {
				t.Fatalf("optional call rewritten: %+v", fixed)
			}
		})
	}
}
func TestOptionalCatchPipelinePreservesCalls(t *testing.T) {
	for _, api := range []string{"catch", "catchTag", "catchTags"} {
		t.Run(api, func(t *testing.T) {
			source := optionalDirectFormSource(api, 0, "direct", false)
			source = strings.Replace(source, "return try Effect."+api+"?.(e,", "return try (e |> Effect."+api+"?.(%,", 1)
			source = strings.TrimSuffix(source, "}") + ")}"
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == 4835 {
					t.Fatalf("pipeline control: %s", d.String())
				}
			}
			fixed := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed.Err != nil || len(fixed.Files) != 0 {
				t.Fatalf("pipeline optional call rewritten: %+v", fixed)
			}
		})
	}
}
