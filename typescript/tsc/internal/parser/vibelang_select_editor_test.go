package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Token lookup must reach written identifiers through the retired select's
// recovery wrappers, as references, hover and rename all look them up by position.
func TestRetiredSelectEditorTokens(t *testing.T) {
	for _, source := range []string{
		"function f() {}\nexport function main() { select { case const n = f(): } }",
		"function f() {}\nexport function main() { select { default: f(); break; case const n = f(): f(); return n } }",
		"function f() {}\nexport function main() { select { case const n = f(): return n; default: f(); break; case const m = f(): f(); return m } }",
		"function f() {}\nexport function main() { select { case const n = f(): return n } }",
		"function f() {}\nexport function main() { select { case const n = f(): f(); return n; case const m = f(): return m } }",
		"function f() {}\nexport function main() { select { case f(): break; case f(): break; default: f() } }",
		"function f() {}\nexport function main() { select { case const n = (f()): return n; default: return f() } }",
	} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		var written []*ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsIdentifier(n) && (n.Text() == "f" || n.Text() == "n" || n.Text() == "m") && n.Flags&ast.NodeFlagsReparsed == 0 {
				written = append(written, n)
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if len(written) < 2 {
			t.Fatal("missing written identifiers")
		}
		for _, want := range written {
			offset := want.End() - len(want.Text())
			if got := astnav.GetTouchingPropertyName(file, offset); got != want {
				t.Errorf("at %d in %s: got %s under %s; want written %s", offset, strings.ReplaceAll(source, "\n", " "), got.Kind, got.Parent.Kind, want.Text())
			}
		}
	}
}
