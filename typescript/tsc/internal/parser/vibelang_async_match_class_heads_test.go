package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangAsyncMatchClassHeads(t *testing.T) {
	heads := []string{
		"class C { [do { %; \"m\" }](){} }",
		"class C { [do { %; \"m\" }]=1 }",
		"class C { get [do { %; \"m\" }](){return 1} }",
		"class C { set [do { %; \"m\" }](n:number){} }",
		"class C { @(do { %; ((v:unknown,c:unknown)=>{}) }) m(){} }",
		"@(do { %; ((v:unknown,c:unknown)=>{}) }) class C {}",
		"class C extends do { %; (class {}) } {}",
	}
	for _, head := range heads {
		for _, jump := range []string{"return 9", "break outer", "continue outer"} {
			expression := "do {" + strings.Replace(head, "%", jump, 1) + "; 1}"
			for _, match := range []string{
				"async match(" + expression + "){default:1;}",
				"async match(1){default:" + expression + ";}",
				"async match(1){when let n and if (" + expression + "):1;default:0;}",
			} {
				source := "function f(){outer:while(true){return " + match + "}}"
				t.Run(source, func(t *testing.T) {
					file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source, core.ScriptKindTS)
					got := file.Diagnostics()
					if len(got) != 1 || got[0].Source() != "EK" || got[0].Code() != 706 {
						t.Fatalf("want only EK0706, got %v", got)
					}
				})
			}
		}
	}
}

func TestVibeLangAsyncMatchClassHeadLocalControl(t *testing.T) {
	for _, head := range []string{
		"class C { [do { local:{break local}; \"m\" }](){} }",
		"class C { [do { for(let i=0;i<1;i++){continue}; \"m\" }]=1 }",
		"class C { m(){return 1} }",
		"class C { get x(){return 1} }",
		"class C { value=()=>{return 1} }",
		"class C extends do { (class {}) } {}",
	} {
		source := "function f(){return async match(1){default:do{" + head + ";1};}}"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, source, core.ScriptKindTS)
		if got := file.Diagnostics(); len(got) != 0 {
			t.Errorf("local control: %v in %s", got, source)
		}
	}
}
