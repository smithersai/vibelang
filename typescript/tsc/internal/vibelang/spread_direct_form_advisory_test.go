package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func spreadDirectFormSource(api string, spread int, style string, alias bool) string {
	prefix := "type Tagged={readonly _tag:\"Oops\"};service S{static readonly key=\"advisory/Optional\";value:number};"
	ns := "Effect"
	if alias {
		prefix = "import {Effect as Library} from \"effect\";" + prefix
		ns = "Library"
	}
	callee := ns + "." + api
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
	setup := "const args=[" + args + "] as const;"
	call := callee + "(...args)"
	switch spread {
	case 1:
		setup = ""
		call = callee + "(...[" + args + "] as const)"
	case 2:
		setup = ""
		call = callee + "(" + args + ",...[] as const)"
	case 3:
		setup = ""
		call = callee + "(...[] as const," + args + ")"
	}
	body := "return try " + call
	switch style {
	case "parenthesized":
		body = "return try (" + call + ")"
	case "nonnull":
		body = "return try (" + call + ")!"
	case "stored":
		body = "const stored=" + call + ";return try stored"
	}
	return prefix + "export effect function f(e:number!Tagged!S,h:(x:Tagged)=>number!!){" + setup + body + "}"
}
func spreadDirectFormCode(api string) int32 {
	switch api {
	case "succeed", "fail":
		return 4834
	case "catch", "catchTag", "catchTags":
		return 4835
	}
	return 4836
}
func TestSpreadDirectFormAdvisories(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		for chain := range 4 {
			for _, alias := range []bool{false, true} {
				for _, style := range []string{"direct", "parenthesized", "nonnull", "stored"} {
					t.Run(fmt.Sprintf("%s/spread%d/alias%t/%s", api, chain, alias, style), func(t *testing.T) {
						if api == "provide" && chain >= 2 {
							t.Skip("native provide logical argument positions: FuzzSpreadDirectFormAdvisories provide-empty-leading/provide-empty-trailing")
						}

						p, file, _, _ := editorProgram(t, spreadDirectFormSource(api, chain, style, alias))
						count := 0
						for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && d.Code() == spreadDirectFormCode(api) {
								count++
								if !strings.Contains(diagnosticWithNotes(d), "spread iteration") {
									t.Fatalf("missing spread-call explanation: %s", diagnosticWithNotes(d))
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
func TestSpreadDirectFormAdvisoriesPreserveCalls(t *testing.T) {
	for _, api := range []string{"succeed", "fail", "catch", "catchTag", "catchTags", "provide", "provideService"} {
		t.Run(api, func(t *testing.T) {
			p, file, service, converters := editorProgram(t, spreadDirectFormSource(api, 0, "direct", false))
			var found *ast.Diagnostic
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == spreadDirectFormCode(api) {
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
						t.Fatalf("spread call rewrite offered: %s", a.CodeAction.Title)
					}
				}
			}
		})
	}
}

func TestSpreadCatchPipelinePreservesCalls(t *testing.T) {
	for _, api := range []string{"catch", "catchTag", "catchTags"} {
		t.Run(api, func(t *testing.T) {
			source := spreadDirectFormSource(api, 1, "direct", false)
			source = strings.Replace(source, "return try Effect."+api+"(...[e,", "return try (e |> Effect."+api+"(...[%,", 1)
			source = strings.TrimSuffix(source, "}") + ")}"
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == 4835 {
					t.Fatalf("pipeline control: %s", d.String())
				}
			}
		})
	}
}
func TestSpreadDirectFormsIgnoreOperators(t *testing.T) {
	for _, call := range []string{
		"Effect.catch(...[(e:Tagged)=>succeed(1)] as const)",
		"Effect.provide(...[Layer.succeed(S,{value:1})] as const)",
		"Effect.provideService(...[S,{value:1}] as const)",
	} {
		t.Run(call, func(t *testing.T) {
			source := "type Tagged={readonly _tag:\"Oops\"};service S{static readonly key=\"advisory/Operator\";value:number};export effect function f(){return try " + call + "}"
			p, file, _, _ := editorProgram(t, source)
			errors := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					errors++
				}
				if d.Source() == diagnosticSource && (d.Code() == 4834 || d.Code() == 4835 || d.Code() == 4836) {
					t.Fatalf("data-last operator got direct-call advisory: %s", d.String())
				}
			}
			if errors == 0 {
				t.Fatal("try unexpectedly accepted a data-last operator")
			}
		})
	}
}
