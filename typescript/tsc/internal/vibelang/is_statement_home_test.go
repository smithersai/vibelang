package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

var statementHomeTests = []struct{ name, body string }{
	{"if", "if (true) BODY"},
	{"else", "if (false) {} else BODY"},
	{"for", "for (let i=0;i<1;i++) BODY"},
	{"for-of", "for (const x of [1,2]) BODY"},
	{"for-in", "for (const x in {a:1}) BODY"},
	{"while", "while (false) BODY"},
	{"do-while", "do BODY while (false)"},
	{"label", "label: BODY"},
	{"nested", "for (const x of [1,2]) if (true) BODY"},
	{"else-if", "if (false) {} else if (1 is let id) void id"},
	{"return", "if (true) return (1 is let id) ? id : 0"},
	{"throw", "if (false) throw (1 is let id) ? id : 0"},
	{"expression", "if (true) void (1 is let id)"},
	{"comment", "if (true) /* keep */ BODY // tail\n"},
}

func TestIsStatementHomeRejection(t *testing.T) {
	for _, tc := range statementHomeTests {
		t.Run(tc.name, func(t *testing.T) {
			source := "export function f() { " + strings.ReplaceAll(tc.body, "BODY", "if (1 is let id) void id") + "; return 0 }"
			if tc.name == "throw" {
				source = strings.Replace(source, "export function", "export effect function", 1)
			}
			p, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				found = found || d.Code() == 705
			}
			if !found {
				t.Fatalf("missing EK0705 in %s", source)
			}
		})
	}
}

func TestIsStatementHomeRepair(t *testing.T) {
	for _, tc := range statementHomeTests {
		t.Run(tc.name, func(t *testing.T) {
			source := "export function f() { " + strings.ReplaceAll(tc.body, "BODY", "if (1 is let id) void id") + "; return 0 }"
			if tc.name == "throw" {
				source = strings.Replace(source, "export function", "export effect function", 1)
			}
			p, file, service, converters := editorProgram(t, source)
			var diagnostic *ast.Diagnostic
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 705 {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatal("missing EK0705")
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only}})
			if err != nil {
				t.Fatal(err)
			}
			var fixed string
			if response.CommandOrCodeActionArray != nil {
				for _, a := range *response.CommandOrCodeActionArray {
					if a.CodeAction != nil && a.CodeAction.Title == "Wrap the statement body in braces" && a.CodeAction.Edit != nil && a.CodeAction.Edit.Changes != nil {
						fixed = applyEditorEdits(t, file, converters, (*a.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
					}
				}
			}
			if fixed == "" {
				t.Fatal("no brace quick fix")
			}
			if ds := errorsOf(t, fixed); len(ds) != 0 {
				t.Fatalf("repair: %v\n%s", ds, fixed)
			}
			for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				if len(result.Refused) != 0 || len(result.Files) != 1 {
					t.Fatalf("--fix: %+v", result)
				}
				text := result.Files[file.FileName()].Text
				if ds := errorsOf(t, text); len(ds) != 0 {
					t.Fatalf("--fix output: %v\n%s", ds, text)
				}
				if tc.name != "nested" && text != fixed {
					t.Fatalf("editor/CLI differ:\n%s\n%s", fixed, text)
				}
			}
		})
	}
}

func TestIsStatementHomeControls(t *testing.T) {
	for _, source := range []string{
		"function f(){if(1 is let id) return id;return 0}",
		"function f(){for(const x of [1,2]) {if(x is let id) void id}}",
		"function f(){if(true) void do {const ok=1 is let id;ok}}",
		"function f(){if(true) void (()=>1 is let id)}",
		"function f(){if(true) void (1 is Number)}",
		"function f(){if(true) for(let i=(1 is let id)?id:0;i<1;i++) void i}",
	} {
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("control: %v\n%s", ds, source)
		}
	}
}
