package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

// RC48: source value names cannot turn into primitive schema type syntax.
func TestSchemaValueKeywordRepairDeclined(t *testing.T) {
	for _, name := range []string{"string", "number", "boolean", "bigint", "symbol", "undefined", "any", "unknown", "never", "object", "intrinsic", "keyof", "readonly", "unique", "infer"} {
		codec := "Schema.String"
		if name == "string" {
			codec = "Schema.Number"
		}
		prefix := "export const " + name + "=" + codec + ";"
		for i, body := range []string{
			"export const X=" + name + ";export type X=typeof X.Type;",
			"export const X=Schema.Struct({field:" + name + "});",
			"export const X=Schema.Struct({child:Schema.Struct({field:" + name + "})});",
		} {
			t.Run(fmt.Sprintf("%s/%d", name, i), func(t *testing.T) {
				program, file, service, converters := editorProgram(t, prefix+body)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid native input: %s", d.String())
					}
					if d.Source() == diagnosticSource && (d.Code() == 4832 || d.Code() == 4841) {
						ld := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
						response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
							TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
							Range:        ld.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{ld}},
						})
						if err != nil {
							t.Fatal(err)
						}
						if response.CommandOrCodeActionArray != nil {
							for _, item := range *response.CommandOrCodeActionArray {
								if item.CodeAction != nil && item.CodeAction.Edit != nil && strings.HasPrefix(item.CodeAction.Title, "Write schema ") {
									t.Fatalf("unsafe keyword repair offered: %s", item.CodeAction.Title)
								}
							}
						}
					}
				}
			})
		}
	}
}
func TestSchemaValueKeywordRepairControls(t *testing.T) {
	for _, name := range []string{"string", "number", "boolean", "bigint", "symbol", "undefined", "any", "unknown", "never", "object", "intrinsic", "keyof", "readonly", "unique", "infer", "Array", "Record", "asserts", "type", "as", "satisfies"} {
		for _, qualified := range []bool{false, true} {
			prefix, ref := "const Named=Schema.Number;", "Named"
			if name == "Array" || name == "Record" || name == "asserts" || name == "type" || name == "as" || name == "satisfies" {
				prefix = "const " + name + "=Schema.Number;"
				ref = name
			}
			if qualified {
				prefix = "const holder={" + name + ":Schema.Number};"
				ref = "holder." + name
			}
			for _, body := range []string{
				"export const X=" + ref + ";export type X=typeof X.Type;",
				"export const X=Schema.Struct({field:" + ref + "});",
			} {
				code := int32(4841)
				if strings.Contains(body, "Struct") {
					code = 4832
				}
				fixed := applyQuickFixOf(t, prefix+body, code, diagnostics.CategoryWarning)
				if !strings.Contains(fixed, ref) {
					t.Fatalf("reference lost: %s", fixed)
				}
				program, file, _, _ := editorProgram(t, fixed)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("invalid fixed control: %s; %s", d.String(), fixed)
					}
				}
			}
		}
	}
}
