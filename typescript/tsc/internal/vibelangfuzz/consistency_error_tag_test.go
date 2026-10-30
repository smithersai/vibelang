package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-13 makes an error's name its public _tag value. Renaming it changes
// that value even though the source contains no quoted spelling of the name.
// This is not an alpha rename: an unchanged catchTags key can stop matching.
func TestConsistencyImplicitErrorTag(t *testing.T) {
	w := NewWorkspace(t)
	source, err := os.ReadFile(filepath.Join(Root(), "typescript/vibelang/cases/rewrite-catch-scope/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"main.vibe": string(source)}
	r := toolsCompile(t, w, consistencyTarget, files)
	defer r.Remove()
	if HasError(r.Diagnostics) {
		t.Fatalf("baseline must type-check: %v", Keys(r.Dir, r.Diagnostics))
	}
	c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.vibe", archive: Archive(files)}
	p := c.project(r, files)
	c.before = p
	var symbol *consistencySymbol
	for _, s := range c.symbols() {
		if s.name == "A" && s.kind == "ClassDeclaration" {
			symbol = s
			break
		}
	}
	if symbol == nil || len(symbol.refs) == 0 {
		t.Fatal("error A must remain a rename/reference probe")
	}
	probe := consistencyProbe{consistencySymbol: symbol, consistencyRef: symbol.refs[0]}
	fresh := consistencyFreshName(files)
	response, err := p.service.ProvideRename(t.Context(), &lsproto.RenameParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: p.uri(c.main)},
		Position:     p.position(c.main, probe.start), NewName: fresh,
	}, nil)
	if err != nil || response.WorkspaceEdit == nil {
		t.Fatalf("rename failed: %v %v", response, err)
	}
	edited, ok := c.apply(p, "error rename", "consistency:rename:ClassDeclaration", fresh, response.WorkspaceEdit)
	if !ok {
		t.Fatal("rename must produce valid edits")
	}
	after := toolsCompile(t, w, consistencyTarget, edited.files)
	defer after.Remove()
	beforeJS := strings.Join(slices.Collect(maps.Values(r.Outputs)), "\n")
	afterJS := strings.Join(slices.Collect(maps.Values(after.Outputs)), "\n")
	if !strings.Contains(beforeJS, `"A"`) || !strings.Contains(afterJS, `"`+fresh+`"`) {
		t.Fatal("the emitted public error tag must follow the renamed declaration")
	}
	if !HasError(after.Diagnostics) {
		t.Fatal("the old catchTags key must expose the changed tag")
	}
	refs := c.checkReferences(probe)
	if refs == nil {
		t.Fatal("the error class must still receive reference checks")
	}
	c.checkRename(probe, refs)
}

// Ordinary classes, comments, strings and another declaration's tag must not
// take an ordinary binding out of the diagnostic-parity check.
func TestConsistencyImplicitTagScope(t *testing.T) {
	for _, c := range []struct {
		source string
		want   bool
	}{
		{"error A { n: number }", true},
		{"schema error A { n: number }", true},
		{"class A { n = 1 }", false},
		{"/* error A {} */ class A {}", false},
		{"const text = \"error A {}\"; class A {}", false},
		{"error Other {} class A {}", false},
	} {
		t.Run(c.source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/scope.vibe", PathKey: "/scope.vibe"}, c.source)
			var declaration *ast.Node
			for _, n := range file.Statements.Nodes {
				if n.Kind == ast.KindClassDeclaration && n.Name() != nil && n.Name().Text() == "A" {
					declaration = n
					break
				}
			}
			if declaration == nil {
				t.Fatal("class A declaration missing")
			}
			if got := consistencyImplicitTag(declaration); got != c.want {
				t.Fatalf("public implicit tag = %v, want %v", got, c.want)
			}
		})
	}
}
