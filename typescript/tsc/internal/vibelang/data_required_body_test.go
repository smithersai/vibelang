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

func TestDataRequiredBodyExpressionRepair(t *testing.T) {
	prefix := "// café 😀\nconst data = 1; type T = number;\n"
	for _, expr := range []string{
		"data as T", "data satisfies T", "data /* keep */ as T",
		"data as T as number", "data satisfies T satisfies number",
		"data as T, data satisfies T", "data as T && 2", "data as T\n+ 2",
		"data as T /* tail */",
		"data is Number", "data is 1", "data is Number || false",
		"data is Number or String", "data is /x/", "data is [1]",
	} {
		source := prefix + expr + ";\nexport {}"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		edits := dataHeaderExpressionEdits(file, nil)
		if len(edits) != 2 {
			t.Errorf("%q: got %v", expr, edits)
			continue
		}
		got := applyEdits(source, edits)
		fixed := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, got, core.ScriptKindTS)
		if ds := fixed.Diagnostics(); len(ds) != 0 {
			t.Errorf("repair %q rejected: %v", got, ds)
		}
		if again := dataHeaderExpressionEdits(fixed, nil); len(again) != 0 {
			t.Errorf("repair not idempotent: %v", again)
		}
		if edits[0].text != "(" || edits[1].text != ")" || edits[0].start != edits[0].end || edits[1].start != edits[1].end {
			t.Errorf("not a parenthesizing repair: %v", edits)
		}
	}
	for _, source := range []string{"data Missing;", "data as ;", "data as { V };", "data as { toFixed: unknown };", "const data=1; (data as number);"} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if got := dataHeaderExpressionEdits(file, nil); len(got) != 0 {
			t.Errorf("unsafe repair of %q: %v", source, got)
		}
	}
}

func TestDataRequiredBodyQuickFixSelection(t *testing.T) {
	source := "// café 😀\nconst data=1; type T=number;\ndata as T;\ndata satisfies T;\ndata is Number;\nexport {}"
	program, file, service, converters := editorProgram(t, source)
	count := 0
	for _, diagnostic := range program.GetSyntacticDiagnostics(t.Context(), file) {
		if diagnostic.Source() != "EK" || diagnostic.Code() != 1604 {
			continue
		}
		count++
		d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}},
		})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		if response.CommandOrCodeActionArray != nil {
			for _, a := range *response.CommandOrCodeActionArray {
				if a.CodeAction == nil || a.CodeAction.Title != dataExpressionFixTitle {
					continue
				}
				found = true
				if a.CodeAction.Edit == nil || a.CodeAction.Edit.Changes == nil {
					t.Fatal("missing changes")
				}
				edits := (*a.CodeAction.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())]
				if len(edits) != 2 {
					t.Fatalf("got %d edits, want 2", len(edits))
				}
				got := applyEditorEdits(t, file, converters, edits)
				for i, expression := range []string{"data as T", "data satisfies T", "data is Number"} {
					want := expression + ";"
					if i == count-1 {
						want = "(" + expression + ");"
					}
					if !strings.Contains(got, "\n"+want) {
						t.Errorf("wrong expression selected: %s", got)
					}
				}
			}
		}
		if !found {
			t.Fatal("missing EK1604 quick fix")
		}
	}
	if count != 3 {
		t.Fatalf("got %d EK1604 diagnostics, want 3", count)
	}
}

func TestDataRequiredBodyVibexRepair(t *testing.T) {
	source := "const view = <div />;\nconst data=1; type T=number;\ndata as T;\ndata is Number;\nexport {}"
	parse := func(text string) *ast.SourceFile {
		return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibex", PathKey: "/main.vibex"}, text, core.ScriptKindTSX)
	}
	for range 3 {
		edits := dataHeaderExpressionEdits(parse(source), nil)
		if len(edits) == 0 {
			break
		}
		source = applyEdits(source, edits)
	}
	if ds := parse(source).Diagnostics(); len(ds) != 0 {
		t.Fatalf("JSX repair rejected: %v", ds)
	}
	if !strings.Contains(source, "(data as T);") || !strings.Contains(source, "(data is Number);") {
		t.Fatalf("missing JSX repairs: %s", source)
	}
}
