package parser_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangConcurrentSelfContinue(t *testing.T) {
	for _, tc := range []struct {
		name, body         string
		returns, continues int
	}{
		{"direct", "continue own", 1, 0},
		{"do-expression", "const value = do { if(x===1) continue own; 0 }; void value", 1, 0},
		{"do-unlabeled", "const value = do { if(x===1) continue; 0 }; void value", 1, 0},
		{"do-native-loop", "for(const y of [1]) { const value = do { if(x===1)continue own;0 };void value }", 1, 0},
		{"do-local-loop", "for(const y of [1]) { const value = do { if(x===1)continue;0 };void value }", 0, 1},
		{"do-written-function", "function f(){const value = do {continue own};void value}", 0, 1},
		{"do-nested-item", "for concurrent(const y of [1]){const value = do {continue own};void value}", 0, 1},
		{"match-expression", "const value = match(x) {when 1: do { continue own }; default: 0;}; void value", 1, 0},
		{"conditional", "if(x) continue own", 1, 0},
		{"switch", "switch(x){case 1:continue own;default:break}", 1, 0},
		{"for", "for(let i=0;i<2;i++)continue own", 1, 0},
		{"for-of", "for(const n of [1])continue own", 1, 0},
		{"for-in", "for(const n in {})continue own", 1, 0},
		{"while", "while(x)continue own", 1, 0},
		{"do-while", "do continue own;while(x)", 1, 0},
		{"local-label", "local:while(x){continue local};continue own", 1, 1},
		{"native-function", "function f(){continue own}", 0, 1},
		{"effect-block", "const p=effect {continue own}", 0, 1},
		{"nested-item", "for concurrent(const y of [1]){continue own}", 0, 1},
		{"stream-item", "for try(const y of s){continue own}", 0, 1},
	} {
		for _, labels := range []string{"own:", "own: alias:", "alias: own:"} {
			t.Run(tc.name+"/"+labels, func(t *testing.T) {
				source := fmt.Sprintf("effect function f(){%s for concurrent(const x of [1,2]){%s}}", labels, tc.body)
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
				if len(file.Diagnostics()) != 0 {
					t.Fatal(file.Diagnostics())
				}
				returns, continues := 0, 0
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if n.Kind == ast.KindReturnStatement && n.Flags&ast.NodeFlagsReparsed != 0 {
						returns++
					}
					if n.Kind == ast.KindContinueStatement {
						continues++
					}
					return n.ForEachChild(visit)
				}
				file.AsNode().ForEachChild(visit)
				if returns != tc.returns || continues != tc.continues {
					t.Fatalf("returns/continues=%d/%d, want %d/%d", returns, continues, tc.returns, tc.continues)
				}
			})
		}
	}
}
