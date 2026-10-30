package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestEffectBigintMethods(t *testing.T) {
	for _, source := range []string{
		`class C { effect 1n() { return 1 } }`,
		`class C { static effect 1_000n<T>(x: T) { return x } }`,
		`const c = { effect 1n() { return 1 } }`,
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
		if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
			t.Fatalf("bigint effect method rejected: %v\n%s", diagnostics, source)
		}
		marked := 0
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Kind == ast.KindMethodDeclaration && node.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				marked++
				if node.Name().Kind != ast.KindBigIntLiteral {
					t.Fatalf("bigint name became %v", node.Name().Kind)
				}
			}
			return node.ForEachChild(visit)
		}
		visit(file.AsNode())
		if marked != 1 {
			t.Fatalf("got %d marked methods, want 1", marked)
		}
	}
}
