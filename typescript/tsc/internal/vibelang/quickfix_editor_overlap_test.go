package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestQuickFixKeepsOtherCodesRefusedSpan(t *testing.T) {
	for _, crlf := range []bool{false, true} {
		source := "// @vibelang-diagnostics EK4824:warning\n// café 😀\nimport type * as Native from \"effect/Effect\"\nexport const applied=pipe(7)\nconst program:Native.Effect<number,string>=Effect.fail(\"oops\")\nexport function main(){return program as Native.Effect<number>}\n"
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			diagnostics := program.GetSemanticDiagnostics(t.Context(), file)
			var refused, inner, outside *ast.Diagnostic
			for _, d := range diagnostics {
				if d.Source() == "EK" && d.Code() == 4810 {
					refused = d
				}
			}
			if refused == nil {
				t.Fatal("missing refused assertion diagnostic")
			}
			for _, d := range diagnostics {
				if d.Source() != "EK" {
					continue
				}
				if d.Code() == 4833 && d.Pos() >= refused.Pos() && d.End() <= refused.End() {
					inner = d
				}
				if d.Code() == 4824 {
					outside = d
				}
			}
			if outside == nil {
				t.Fatalf("missing outside witness: %v", diagnostics)
			}
			protected := lsconv.DiagnosticToLSPPush(t.Context(), converters, refused).Range
			less := func(a, b lsproto.Position) bool {
				return a.Line < b.Line || a.Line == b.Line && a.Character < b.Character
			}
			overlap := func(a, b lsproto.Range) bool {
				if a.Start == a.End {
					return less(b.Start, a.Start) && less(a.Start, b.End)
				}
				return less(a.Start, b.End) && less(b.Start, a.End)
			}
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			for _, test := range []struct {
				name        string
				diagnostic  *ast.Diagnostic
				requireEdit bool
			}{{"inner", inner, false}, {"outside", outside, true}} {
				if test.diagnostic == nil {
					continue
				}
				t.Run(test.name, func(t *testing.T) {
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, test.diagnostic)
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: d.Range,
						Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
					})
					if err != nil {
						t.Fatal(err)
					}
					count := 0
					if response.CommandOrCodeActionArray != nil {
						for _, item := range *response.CommandOrCodeActionArray {
							action := item.CodeAction
							if action == nil || action.Edit == nil || action.Edit.Changes == nil {
								continue
							}
							for _, edit := range (*action.Edit.Changes)[uri] {
								count++
								if overlap(edit.Range, protected) {
									t.Errorf("repair overlaps refused EK4810 span: %s, edit=%v protected=%v", action.Title, edit.Range, protected)
								}
							}
						}
					}
					if test.requireEdit && count == 0 {
						t.Fatal("outside preserving repair must remain available")
					}
				})
			}
		})
	}
}

func TestQuickFixAllowsNonDroppingAssertions(t *testing.T) {
	for _, source := range []string{
		"const program:Effect.Effect<number>=Effect.succeed(7)\nexport function main(){return program as Effect.Effect<number>}",
		"const program:Effect.Effect<number,string>=Effect.fail(\"oops\")\nexport function main(){return program as Effect.Effect<number,string>}",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			at := strings.Index(source, " as ")
			found := false
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Code() == 4810 {
					t.Fatal("positive assertion unexpectedly drops a channel")
				}
				if diagnostic.Source() != "EK" || diagnostic.Code() != 4833 || diagnostic.Pos() < at {
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
				offered := false
				if response.CommandOrCodeActionArray != nil {
					for _, item := range *response.CommandOrCodeActionArray {
						if action := item.CodeAction; action != nil && action.Edit != nil && action.Edit.Changes != nil && len(*action.Edit.Changes) > 0 {
							offered = true
						}
					}
				}
				if !offered {
					t.Fatal("a non-dropping assertion must retain its spelling repair")
				}
			}
			if !found {
				t.Fatal("missing positive spelling diagnostic")
			}
		})
	}
}
