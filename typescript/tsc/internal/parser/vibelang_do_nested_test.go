package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangNestedDoEarlyErrors(t *testing.T) {
	for depth := 1; depth <= 4; depth++ {
		wrap := func(body string) string {
			for i := 0; i < depth; i++ {
				body = "(do { " + body + " })"
			}
			return body
		}
		for _, test := range []struct {
			name, source string
			code         int32
		}{
			{"break", "function f() { while (" + wrap("break; true") + ") {} }", parser.DoLoopHeadCode},
			{"continue", "function f() { while (" + wrap("continue; true") + ") {} }", parser.DoLoopHeadCode},
			{"label", "function f() { a: b: while (" + wrap("break a; true") + ") {} }", parser.DoLoopHeadCode},
			{"parameter", "function f(x = " + wrap("var v = 1; v") + ") {}", parser.DoParameterVarCode},
			{"pattern", "function f({x = " + wrap("var v = 1; v") + "} = {}) {}", parser.DoParameterVarCode},
			{"array-pattern", "function f([x = " + wrap("var v = 1; v") + "] = []) {}", parser.DoParameterVarCode},
			{"arrow-parameter", "const f = (x = " + wrap("var v = 1; v") + ") => x", parser.DoParameterVarCode},
			{"method-parameter", "class C { m(x = " + wrap("var v = 1; v") + ") {} }", parser.DoParameterVarCode},
			{"constructor-parameter", "class C { constructor(x = " + wrap("var v = 1; v") + ") {} }", parser.DoParameterVarCode},
			{"for-of-break", "function f() { for (const x of " + wrap("break; []") + ") {} }", parser.DoLoopHeadCode},
			{"for-in-continue", "function f() { for (const x in " + wrap("continue; ({})") + ") {} }", parser.DoLoopHeadCode},
			{"for-of-label", "function f() { a: b: for (const x of " + wrap("break a; []") + ") {} }", parser.DoLoopHeadCode},
			{"for-in-label", "function f() { a: b: for (const x in " + wrap("continue a; ({})") + ") {} }", parser.DoLoopHeadCode},
			{"parameter-match", "function f(x = match (0) { default: " + wrap("var v = 1; v") + " }) {}", parser.DoParameterVarCode},
			{"parameter-do-match", "function f(x = do { match (0) { default: " + wrap("var v = 1; v") + " } }) {}", parser.DoParameterVarCode},
			{"loop-match-break", "function f() { while (match (0) { default: " + wrap("break; true") + " }) {} }", parser.DoLoopHeadCode},
			{"loop-match-continue", "function f() { while (match (0) { default: " + wrap("continue; true") + " }) {} }", parser.DoLoopHeadCode},
			{"loop-match-local", "function f() { while (match (0) { default: " + wrap("while (true) { break; } true") + " }) {} }", 0},
			{"local-loop", "function f() { while (" + wrap("while (true) { break; } true") + ") {} }", 0},
			{"enclosing", "function f() { outer: while (true) { while (" + wrap("break outer; true") + ") {} } }", 0},
			{"source-function", "function f(x = " + wrap("(() => { var v = 1; return v })()") + ") {}", 0},
			{"source-class", "function f(x = " + wrap("class C { m() { var v = 1; return v } }; 1") + ") {}", 0},
			{"nested-local-loop", "function f() { while (do { while (true) { const x = " + wrap("break; true") + "; } true }) {} }", 0},
		} {
			t.Run(fmt.Sprintf("%s/%d", test.name, depth), func(t *testing.T) {
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, test.source)
				want := 0
				if test.code != 0 {
					want = 1
				}
				if got := file.Diagnostics(); len(got) != want || want == 1 && got[0].Code() != test.code {
					t.Errorf("want EK%04d once (or no error for zero), got %v; %s", test.code, got, strings.TrimSpace(test.source))
				}
			})
		}
	}
}
