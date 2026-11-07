package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-15 and decided detail 241: two fields of a schema body on one line
// with no separator are EK1504, at the insertion point after the first.
func TestSchemaFieldSeparators(t *testing.T) {
	for _, tc := range []struct{ name, source, preceding string }{
		{"fields", "schema S { a: string b: number }", "string"},
		{"exported", "export schema S { a: string b: number }", "string"},
		{"optional field", "schema S { a?: string b: number }", "string"},
		{"readonly field", "schema S { readonly a: string b: number }", "string"},
		{"nested type then field", "schema S { a: { n: number } b: string }", "}"},
		{"field comment", "schema S { a: string /* keep */ b: number }", "string"},
		{"quoted key", "schema S { \"a\": string b: number }", "string"},
		{"computed key", "declare const key: unique symbol; schema S { [key]: number b: string }", "number"},
		{"union field", "schema S { a: \"x\" | \"y\" b: number }", "\"y\""},
		{"in a namespace", "namespace N { export schema S { a: string b: number } }", "string"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "// café 😀\n" + tc.source
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1504 {
				t.Fatalf("want only EK1504, got %v", ds)
			}
			d := ds[0]
			if d.Len() != 0 || !strings.HasSuffix(source[:d.Pos()], tc.preceding) {
				t.Fatalf("separator insertion is not after the preceding field: %d:%d in %q", d.Pos(), d.End(), source)
			}
			fixed := source[:d.Pos()] + ";" + source[d.Pos():]
			reparsed := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, fixed, core.ScriptKindTS)
			if len(reparsed.Diagnostics()) != 0 {
				t.Fatalf("inserting one semicolon left %v", reparsed.Diagnostics())
			}
		})
	}
}

// Only a schema body's own fields use EK1504: a nested object type, an alias
// type and an error body keep their diagnostics, and written separators stay
// valid.
func TestSchemaFieldSeparatorIsolation(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"nested field type", "schema S { a: { n: number s: string }; b: string }", 1005},
		{"alias type literal", "schema S = { a: string b: number }", 1005},
		{"vibe type literal", "type S = { a: string b: number }", 1005},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, tc.source, core.ScriptKindTS)
			found := false
			for _, d := range f.Diagnostics() {
				if d.Source() == "EK" {
					t.Errorf("native diagnostic reclassified: %v", d)
				}
				found = found || d.Code() == tc.code
			}
			if !found {
				t.Fatalf("missing native TS%d: %v", tc.code, f.Diagnostics())
			}
		})
	}
	for _, source := range []string{
		"schema S { a: string; b: number }",
		"schema S { a: string, b: number }",
		"schema S { a: string\n b: number }",
		"schema S { a: string /*\n*/ b: number }",
		"schema S { a: { n: number; s: string }; b: string }",
		"schema S { a: string }",
		"schema S {}",
	} {
		f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if len(f.Diagnostics()) != 0 {
			t.Errorf("valid separator rejected: %v\n%s", f.Diagnostics(), source)
		}
	}
}

func TestSchemaFieldSeparatorQuickFix(t *testing.T) {
	for _, source := range []string{
		"export schema S { a: string b: number }",
		"export schema S { a: string /* keep */ b: number }",
		"export schema S { a: { n: number } b: string }",
	} {
		t.Run(source, func(t *testing.T) {
			source = "// café 😀\n" + source
			program, file, service, converters := editorProgram(t, source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 1504 {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing EK1504: %v", program.GetSyntacticDiagnostics(t.Context(), file))
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil && a.CodeAction.Title == "Insert ; between schema fields" {
						chosen = a.CodeAction
					}
				}
			}
			if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatal("missing separator quick fix")
			}
			changes := *chosen.Edit.Changes
			edits := changes[lsconv.FileNameToDocumentURI(file.FileName())]
			if len(changes) != 1 || len(edits) != 1 || edits[0].NewText != ";" {
				t.Fatalf("unexpected edits: %v", changes)
			}
			got := applyEditorEdits(t, file, converters, edits)
			want := source[:diagnostic.Pos()] + ";" + source[diagnostic.Pos():]
			if got != want {
				t.Fatalf("got %q, want %q", got, want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			if ds := checked.GetSyntacticDiagnostics(t.Context(), edited); len(ds) != 0 {
				t.Fatalf("fix left syntax errors: %v", ds)
			}
		})
	}
}
