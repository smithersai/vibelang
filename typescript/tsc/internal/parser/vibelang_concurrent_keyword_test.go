package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestConcurrentKeywordEscapes(t *testing.T) {
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for _, retained := range []bool{false, true} {
			for _, limit := range []string{"", "(2)"} {
				for i := range len("concurrent") {
					for _, extended := range []bool{false, true} {
						escape := fmt.Sprintf("\\u%04x", "concurrent"[i])
						if extended {
							escape = fmt.Sprintf("\\u{%x}", "concurrent"[i])
						}
						word := "concurrent"[:i] + escape + "concurrent"[i+1:]
						source := "effect function f(){for /* header */ " + word + limit + "(const x of [1]){}}"
						t.Run(fmt.Sprintf("%s/retained=%t/limit=%s/letter=%d/extended=%t", fileName, retained, limit, i, extended), func(t *testing.T) {
							file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName), VibeLangDoAsFunction: retained}, source, core.ScriptKindTS)
							ds := file.Diagnostics()
							if len(ds) != 1 || ds[0].Code() != 1260 || ds[0].Pos() != strings.Index(source, word) || ds[0].End() != strings.Index(source, word)+len(word) {
								t.Fatalf("want TS1260 on %q, got %v in %s", word, ds, source)
							}
						})
					}
				}
			}
		}
	}
}

func TestConcurrentKeywordOrdinaryEscapedNames(t *testing.T) {
	for _, source := range []string{
		"effect function f(){for concurrent(const x of [1]){}}",
		"effect function f(){for concurrent(2)(const x of [1]){}}",
		"const con\\u0063urrent=1;export{concurrent}",
		"function f(con\\u0063urrent:(n:number)=>number){return concurrent(1)}",
		"const o={con\\u0063urrent(){return 1}};o.concurrent()",
		"effect function f(){for concurrent(const con\\u0063urrent of [1]){const x=concurrent}}",
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("ordinary spelling rejected: %v in %s", ds, source)
		}
	}
}
