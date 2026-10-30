package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestExplicitServiceKeyScopes(t *testing.T) {
	const named = `{"name":"key-tests","type":"module"}`
	for _, test := range []struct {
		name, source, pkg string
		count             int
	}{
		{"module", "service Root { n: number }", named, 0},
		{"namespace", "namespace Keys { export service Root { n: number } }", named, 0},
		{"function", "function f(): number { service Local { n: number }; return 1 }", named, 1},
		{"blocks", "{ service A { n: number } }\n{ service B { n: number } }", named, 2},
		{"local explicit", `function f(): number { service Local { static readonly key = "local/Key"; n: number }; return 1 }`, named, 0},
		{"empty explicit", `service Empty { static readonly key = ""; n: number }`, `{"type":"module"}`, 0},
		{"unnamed package", "service Missing { n: number }", `{"type":"module"}`, 1},
		{"numeric name", "service Missing { n: number }", `{"name":12,"type":"module"}`, 1},
		{"empty string name", "service Named { n: number }", `{"name":"","type":"module"}`, 0},
		{"outside package", "service Missing { n: number }", "", 1},
		{"legacy typed shape", "interface Api { n: number }; service Typed: Api", `{"type":"module"}`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgramWithPackage(t, test.source, test.pkg)
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 903 {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != test.count {
				t.Fatalf("got %d EK0903, want %d", count, test.count)
			}
		})
	}
}

func TestExplicitServiceKeyQuickFix(t *testing.T) {
	for _, test := range []struct{ name, source, pkg string }{
		{"UTF16 and comment", "const café = '😀'; function f(): number { service Local { /* keep */ n: number }; return 1 }", `{"name":"key-tests","type":"module"}`},
		{"CRLF", "service Missing {\r\n // keep\r\n n: number\r\n}", `{"type":"module"}`},
		{"empty", "service Empty {}", ""},
		{"typed shape without body", "interface Api { n: number }; service Typed: Api", `{"type":"module"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgramWithPackage(t, test.source, test.pkg)
			var item *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == 903 {
					item = d
				}
			}
			if item == nil {
				t.Fatal("missing EK0903")
			}
			var class *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsClassDeclaration(n) && declarationWord(n) == "service" {
					class = n
					return true
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			key := servicesFor(c).key(class)
			done()
			diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, item)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.CommandOrCodeActionArray == nil {
				t.Fatal("missing quick fix")
			}
			var got string
			for _, action := range *response.CommandOrCodeActionArray {
				if action.CodeAction != nil && action.CodeAction.Edit != nil && action.CodeAction.Edit.Changes != nil {
					for _, edits := range *action.CodeAction.Edit.Changes {
						got = applyEditorEdits(t, file, converters, edits)
					}
					break
				}
			}
			if got == "" || !strings.Contains(got, "static readonly key = "+strconv.Quote(key)) {
				t.Fatalf("fix did not preserve old key %q: %s", key, got)
			}
			if strings.Contains(test.source, "keep") && !strings.Contains(got, "keep") {
				t.Fatal("fix dropped comment")
			}
			checked, edited, _, _ := editorProgramWithPackage(t, got, test.pkg)
			for _, d := range checked.GetSemanticDiagnostics(t.Context(), edited) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("edited source has an error: %s\n%s", d.String(), got)
				}
			}
		})
	}
}

func TestExplicitServiceKeyMigration(t *testing.T) {
	const source = "function f(): number { class Legacy extends Context.Service<Legacy, { value: Effect.Effect<number> }>()(\"key-tests/main#Legacy\") {}; return 1 }"
	program, file, _, _ := editorProgramWithPackage(t, source, `{"name":"key-tests","type":"module"}`)
	_ = program
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if len(result.Refused) != 0 {
		t.Fatalf("migration refused: %v", result.Refused)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || !strings.Contains(fixed.Text, `static readonly key = "key-tests/main#Legacy"`) {
		t.Fatalf("migration must keep the local key explicit: %+v", result.Files)
	}
	checked, edited, _, _ := editorProgramWithPackage(t, fixed.Text, `{"name":"key-tests","type":"module"}`)
	for _, d := range checked.GetSemanticDiagnostics(t.Context(), edited) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("migrated source has an error: %s", d.String())
		}
	}
}
