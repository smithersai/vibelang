package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

func TestAsyncMatchComputedHeadOuterTargets(t *testing.T) {
	heads := []string{
		"class C { [do{const pending=%;\"m\"}](){} }",
		"class C { static [do{const pending=%;\"m\"}](){} }",
		"class C { get [do{const pending=%;\"m\"}](){return 1} }",
		"class C { set [do{const pending=%;\"m\"}](n:number){} }",
		"class C { @(do{const pending=%;((v:unknown,c:unknown)=>{})}) m(){} }",
		"const object={ [do{const pending=%;\"m\"}](){} }",
		"const object={ get [do{const pending=%;\"m\"}](){return 1} }",
		"const object={ set [do{const pending=%;\"m\"}](n:number){} }",
	}
	for _, head := range heads {
		for _, jump := range []string{"break outer", "continue outer"} {
			for _, match := range []string{
				"async match(do{" + jump + ";1}){default:1;}",
				"async match(1){default:do{" + jump + ";1};}",
				"async match(1){when let n and if(do{" + jump + ";true}):1;default:0;}",
			} {
				source := "function f(){outer:while(true){" + strings.Replace(head, "%", match, 1) + "}}"
				t.Run(source, func(t *testing.T) {
					file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source, core.ScriptKindTS)
					got := file.Diagnostics()
					if len(got) != 1 || got[0].Source() != "EK" || got[0].Code() != 706 {
						t.Fatalf("want only EK0706,got %v", got)
					}
				})
			}
		}
	}
}

func TestAsyncMatchComputedHeadKeepsWrittenFunctionBoundary(t *testing.T) {
	for _, source := range []string{
		"function f(){outer:while(true){class C{m(){const p=async match(1){default:do{break outer;1};}}}}}",
		"function f(){outer:while(true){const p=(()=>async match(1){default:do{continue outer;1};})()}}",
		"function f(){class C{[do{const p=async match(1){default:do{break missing;1};};\"m\"}](){}}}",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source, core.ScriptKindTS)
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" && d.Code() == 706 {
				t.Fatalf("source has no outer target in this execution context: %v in %s", file.Diagnostics(), source)
			}
		}
	}
}
