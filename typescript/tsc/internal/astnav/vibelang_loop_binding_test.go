package astnav_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangLoopPatternBindingNavigation(t *testing.T) {
	for _, row := range []struct{ name, source string }{
		{"while-short-circuit", "while(true||(1 is const boundValue)){return boundValue}"},
		{"while-reached", "while(1 is const boundValue){return boundValue}"},
		{"for-empty", "for(;true||(1 is const boundValue);){return boundValue}"},
		{"for-let", "for(let n=0;true||(1 is const boundValue);n++){return boundValue}"},
		{"for-const", "for(const n=0;true||(1 is const boundValue);){return boundValue}"},
		{"for-expression", "let n=0;for(n=1;true||(1 is const boundValue);n++){return boundValue}"},
		{"for-update", "for(let n=0;n<2;true||(1 is const boundValue)){return boundValue}"},
		{"do", "do{return boundValue}while(true||(1 is const boundValue))"},
		{"if-control", "if(true||(1 is const boundValue)){return boundValue}"},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "export function f():unknown {" + row.source + "}"
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "fixture.vibe", PathKey: "fixture.vibe"}, source, core.ScriptKindTS)
			var binding *ast.Node
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsVariableDeclarationList(node) && node.AsVariableDeclarationList().Declarations.HasTrailingComma() {
					t.Errorf("source without a trailing comma acquired one in %v", node.Loc)
				}
				if ast.IsVariableDeclaration(node) && node.Name() != nil && node.Name().Text() == "boundValue" {
					binding = node.Name()
				}
				return node.ForEachChild(visit)
			}
			visit(file.AsNode())
			if binding == nil {
				t.Fatal("missing source binding")
			}
			position := strings.Index(source, "const boundValue") + len("const ")
			if token := astnav.GetTouchingPropertyName(file, position); token != binding {
				t.Fatalf("source binding at %d is hidden by %s %v; want %s %v", position, token.Kind, token.Loc, binding.Kind, binding.Loc)
			}
		})
	}
}
