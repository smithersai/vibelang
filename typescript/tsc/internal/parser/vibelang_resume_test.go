package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A handle clause passes its continuation to each resume in its block. The
// arguments the parser adds stand where the written arguments start, so every
// argument of `resume(1)` and `resume()` follows the callee: a language
// feature that walks the tree by position, such as selection ranges (LSP
// 3.17: a parent range contains its child's), finds the call's arguments
// inside the call and after `resume`, never around or before it.
func TestClauseResumeArgumentsFollowTheirCallee(t *testing.T) {
	t.Parallel()
	source := "control Ask { ask(): number!! }\n\neffect function run() {\n  try {\n    return try Ask.ask()\n  } handle Ask.ask() {\n    if (false) { try resume() }\n    return try resume(1)\n  }\n}\n"
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	var calls []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "resume" {
			calls = append(calls, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if len(calls) != 2 {
		t.Fatalf("found %d resume calls, want 2", len(calls))
	}
	for _, call := range calls {
		callee := call.Expression()
		text := source[scanner.SkipTrivia(source, call.Pos()):call.End()]
		arguments := call.AsCallExpression().Arguments
		if len(arguments.Nodes) < 2 {
			t.Fatalf("%s: the clause's continuation was not passed: %d arguments", text, len(arguments.Nodes))
		}
		if arguments.Pos() < callee.End() {
			t.Errorf("%s: the argument list starts at %d, before the callee ends at %d", text, arguments.Pos(), callee.End())
		}
		for i, argument := range arguments.Nodes {
			if argument.Pos() < callee.End() || argument.End() > call.End() {
				t.Errorf("%s: argument %d spans [%d, %d), outside (%d, %d] after the callee", text, i, argument.Pos(), argument.End(), callee.End(), call.End())
			}
		}
	}
}
