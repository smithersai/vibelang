package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-1 permits effect wherever async can mark a method, including computed
// names. Looking through a computed name must not consume a following member
// or turn an ordinary property named effect into a modifier.
func TestEffectComputedMethods(t *testing.T) {
	for _, source := range []string{
		`class C { effect [key]() { return 1 } }`,
		`class C { static effect ["read"]() { return 1 } }`,
		`class C { effect [key]<T>(x: T) { return x } }`,
		`const c = { effect [key]() { return 1 } }`,
		`const c = { effect [keys[index()]]<T>(x: T) { return x } }`,
		`class C { effect *[key]() { yield 1 } }`,
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
				t.Fatalf("computed effect method rejected: %v", diagnostics)
			}
			marked := 0
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if node.Flags&ast.NodeFlagsVibeLangEffect != 0 && node.Kind == ast.KindMethodDeclaration {
					marked++
					if node.Name().Kind != ast.KindComputedPropertyName {
						t.Fatalf("marked a non-computed method: %v", node.Name().Kind)
					}
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
			if marked != 1 {
				t.Fatalf("got %d marked methods, want 1", marked)
			}
		})
	}
	for _, source := range []string{
		"class C { effect\n[key]() { return 1 } }",
		`class C { effect: { [key]: number } = { [key]: 1 } }`,
		`const c = { effect: { [key]: 1 }, [key]() { return 2 } }`,
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
				t.Fatalf("ordinary effect property rejected: %v", diagnostics)
			}
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if node.Flags&ast.NodeFlagsVibeLangEffect != 0 {
					t.Fatal("ordinary effect property treated as a modifier")
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
		})
	}
}
