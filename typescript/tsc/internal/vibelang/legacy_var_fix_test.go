package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// legacyVarActions returns the quick fixes offered for the first EK0107 in
// source, with the source each one produces.
func legacyVarActions(t *testing.T, source string) (titles, results []string) {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK0107.Code {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing EK0107 in:\n%s", source)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray == nil {
		return nil, nil
	}
	for _, item := range *response.CommandOrCodeActionArray {
		if a := item.CodeAction; a != nil && a.Edit != nil && a.Edit.Changes != nil {
			titles = append(titles, a.Title)
			results = append(results, applyEditorEdits(t, file, converters, (*a.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]))
		}
	}
	return titles, results
}

// Chapter 1 Legacy JavaScript: the var quick fix is let, or const when the
// binding has a written type and is never assigned. It is first wherever
// block scoping keeps what runs, and the fixed source compiles with no error.
func TestLegacyVarQuickFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"never assigned", "export function constant(): number { var n: number = 1; return n }", "export function constant(): number { const n: number = 1; return n }"},
		{"assigned", "export function variable(): number { var m = 1; m++; return m }", "export function variable(): number { let m = 1; m++; return m }"},
		{"module scope", "var a = 1\nexport const b = a", "let a = 1\nexport const b = a"},
		{"destructuring", "export function d(o: { x: number }) { var { x } = o; return x }", "export function d(o: { x: number }) { let { x } = o; return x }"},
		{"no initializer", "export function u() { var x: number; x = 1; return x }", "export function u() { let x: number; x = 1; return x }"},
		{"later declarator reads an earlier one", "export function m() { var a = 1, b = a; return b }", "export function m() { let a = 1, b = a; return b }"},
		{"inside a nested block", "export function n(c: boolean) { if (c) { var t = 1; return t } return 0 }", "export function n(c: boolean) { if (c) { let t = 1; return t } return 0 }"},
		{"compound assignment", "export function s() { var total = 0; for (const x of [1, 2]) total += x; return total }", "export function s() { let total = 0; for (const x of [1, 2]) total += x; return total }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			titles, results := legacyVarActions(t, test.source)
			if len(titles) == 0 || !strings.HasSuffix(titles[0], " instead of var") || results[0] != test.want {
				t.Fatalf("first fix %q:\n%v\nwant:\n%s", titles, results, test.want)
			}
			program, file, _, _ := editorProgram(t, results[0])
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("the fixed source reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

// Where let or const could observe a different binding or throw where var
// reads undefined, the var rewrite is not offered.
func TestLegacyVarQuickFixRefusals(t *testing.T) {
	for _, test := range []struct{ name, source string }{

		{"closure after the declaration", "export function k() { var v = 1; return () => v }"},
		{"captured boolean narrowing", "export function f() { var x = true; return () => [x] as const }"},
		{"captured written union", "export function f(c: boolean) { var x: string | undefined = c ? \"yes\" : undefined; if (x) return () => [x] as const }"},
		{"captured in a method", "export function f() { var x = true; return { read() { return [x] as const } } }"},
		{"hoisted function reads it", "export function f() { g(); var x = 1; function g() { return x } return x }"},
		{"read before the declaration", "export function f() { const y = x; var x = 1; return y }"},
		{"own initializer reads it", "export function f() { var x: any = typeof x; return x }"},
		{"closure in a loop", "export function f() { const fs: (() => number)[] = []; for (const i of [1, 2]) { var v = i; fs.push(() => v) } return fs }"},
		{"read outside its block", "export function f(c: boolean) { if (c) { var x = 1 } return x }"},
		{"redeclared", "export function f() { var x = 1; var x = 2; return x }"},
		{"exported", "export var e = 1"},
		{"export specifier", "var n = 1\nexport { n }"},
		{"for head", "export function f() { for (var i = 0; i < 2; i++) {} return 0 }"},
		{"switch case", "export function f(k: number) { switch (k) { case 1: var x = 1; return x } return 0 }"},
		{"labeled", "export function f() { l: var x = 1; return x }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			titles, _ := legacyVarActions(t, test.source)
			for _, title := range titles {
				if strings.HasSuffix(title, " instead of var") {
					t.Fatalf("offered %q for\n%s", title, test.source)
				}
			}
		})
	}
}
