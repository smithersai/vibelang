package parser_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangDoLoopHeadCells(t *testing.T) {
	for _, test := range []struct {
		head, kind string
		cells      int
	}{
		{"let x", "of", 1}, {"const x", "of", 1},
		{"let [x, {y}]", "of", 2}, {"const {x, y: [z]}", "of", 2},
		{"let x", "in", 1}, {"const x", "in", 1},
		{"x", "of", 0}, {"var x", "of", 0}, {"x", "in", 0},
	} {
		t.Run(test.head+"-"+test.kind, func(t *testing.T) {
			source := fmt.Sprintf("function f() { outer: alias: for (%s %s do { capture(() => x); items }) { continue alias } }", test.head, test.kind)
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				t.Fatal(file.Diagnostics())
			}
			cells, loops := 0, 0
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsVariableDeclaration(node) {
					if binding := parser.VibeLangDoHeadBinding(node); binding != nil {
						cells++
						if node.Initializer() != nil || node.AsVariableDeclaration().ExclamationToken == nil {
							t.Fatal("head cell must never initialize, and keep deferred-read checking")
						}
						if binding.Name().Text() != node.Name().Text() {
							t.Fatal("lost source binding")
						}
					}
				}
				if ast.IsForInOrOfStatement(node) {
					loops++
					label := node.Parent
					if !ast.IsLabeledStatement(label) || label.AsLabeledStatement().Label.Text() != "alias" ||
						!ast.IsLabeledStatement(label.Parent) || label.Parent.AsLabeledStatement().Label.Text() != "outer" {
						t.Fatal("source labels no longer directly name the native loop")
					}
				}
				return node.ForEachChild(func(child *ast.Node) bool {
					if child.Parent != node {
						t.Fatalf("%v child of %v lost its parent", child.Kind, node.Kind)
					}
					return visit(child)
				})
			}
			file.AsNode().ForEachChild(func(child *ast.Node) bool {
				if child.Parent != file.AsNode() {
					t.Fatal("source child lost its parent")
				}
				return visit(child)
			})
			if cells != test.cells || loops != 1 {
				t.Fatalf("cells/loops = %d/%d, want %d/1", cells, loops, test.cells)
			}
		})
	}
}
