package parser_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangEffectLoopHeadRecovery(t *testing.T) {
	for _, loop := range []struct {
		name string
		code int32
	}{{"concurrent", 1906}, {"concurrent(2)", 1906}, {"try", 2005}} {
		for _, head := range []string{"var x", "using x", "await using x", "x", "target.x", "var { x }", "using [x]"} {
			t.Run(loop.name+"/"+head, func(t *testing.T) {
				source := "export effect function f() { for " + loop.name + " (" + head + " of xs) { void x } }"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				ds := file.Diagnostics()
				if len(ds) != 1 || ds[0].Code() != loop.code {
					var codes []int32
					for _, d := range ds {
						codes = append(codes, d.Code())
					}
					t.Fatalf("diagnostics = %v; want only EK%04d", codes, loop.code)
				}
			})
		}
	}
}

func TestVibeLangEffectLoopValidHeads(t *testing.T) {
	for _, limit := range []string{"", "(2)", "(limit)", "(using)", "(using + 1)", "(do { 2 })", "(of)", "(limits.of)", "(choose({ of: 2 }))"} {
		for _, head := range []string{"const x", "let x", "const { x }", "let [x]"} {
			t.Run(fmt.Sprint(limit, head), func(t *testing.T) {
				source := "effect function f() { for concurrent" + limit + " (" + head + " of xs) {} }"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				if ds := file.Diagnostics(); len(ds) != 0 {
					t.Fatalf("valid loop rejected: %v", ds)
				}
			})
		}
	}
}
