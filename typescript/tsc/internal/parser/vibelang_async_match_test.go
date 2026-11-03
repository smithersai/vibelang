package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-7: async match owns an async function's await and Promise boundary.
func TestVibeLangAsyncMatchNative(t *testing.T) {
	for _, text := range []string{
		"async match(true){default:2;}",
		"function f(){async match(true){default:2;}}",
		"function f(){return async match(await Promise.resolve(1)){default:await Promise.resolve(2);}}",
		"function f(){return async match(do{await Promise.resolve(); 1}){default:2;}}",
		"effect function f(){return try Effect.promise(()=>async match(await Promise.resolve(1)){default:2;})}",
		"function f(){const result=async match(true){default:do{await Promise.resolve(); 1};}; return result}",
		"function f(){return async match(true){default:(()=>{return 1})();}}",
		"function f(){return async match(true){default:do{while(true){break}; 1};}}",
		"function f(){return async match(true){default:do{inner:while(true){continue inner}; 1};}}",
	} {
		t.Run(text, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
			if got := file.Diagnostics(); len(got) != 0 {
				t.Fatalf("valid async match: %v", got)
			}
			count := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsArrowFunction(n) && ast.HasSyntacticModifier(n, ast.ModifierFlagsAsync) {
					count++
				}
				n.ForEachChild(visit)
				return false
			}
			visit(file.AsNode())
			if count != 1 {
				t.Fatalf("want one async Promise boundary, got %d", count)
			}
		})
	}
}

func TestVibeLangAsyncMatchJumps(t *testing.T) {
	for _, text := range []string{
		"function f(){return async match(1){default:do{return 2};}}",
		"function f(){while(true){const x=async match(1){default:do{break};};}}",
		"function f(){outer:while(true){const x=async match(1){default:do{continue outer};};}}",
		"function f(){const x=async match(do{return 1}){default:2;};}",
		"function f(){return async match(1){default:do{return match(2){default:3;}};}}",
		"function f(){label:{const x=async match(1){default:do{break label};};}}",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
		got := file.Diagnostics()
		if len(got) != 1 || got[0].Source() != "EK" || got[0].Code() != 706 {
			t.Errorf("%s: want only EK0706, got %v", text, got)
		}
	}
}

func TestVibeLangAsyncMatchLookahead(t *testing.T) {
	text := "function f(){return async match(await async match(1){default:2;}){default:3;}}"
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, text, core.ScriptKindTS)
	if got := file.Diagnostics(); len(got) != 0 {
		t.Fatalf("nested async subject: %v", got)
	}
}
