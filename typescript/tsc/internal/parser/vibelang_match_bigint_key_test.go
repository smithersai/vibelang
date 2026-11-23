package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/binder"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangMatchBigIntKeyDoesNotPanic(t *testing.T) {
	source := `export effect function main() {
  const x: unknown = { a: 1 }
  const r = match (x) { when { 1n: 1 }: "one"; default: "other"; }
  return r
}`
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
	binder.BindSourceFile(file)
	var saw707 bool
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "$patternError" {
			args := node.Arguments()
			if len(args) > 0 && args[0].Kind == ast.KindNumericLiteral && args[0].Text() == "707" {
				saw707 = true
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if !saw707 {
		t.Fatalf("expected $patternError(707, ...) for bigint object pattern key")
	}

	// Every prefix truncation (as an editor parses while typing) must parse and bind without panicking.
	for i := 1; i <= len(source); i++ {
		prefix := source[:i]
		f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/prefix.vibe", PathKey: "/prefix.vibe"}, prefix, core.ScriptKindTS)
		binder.BindSourceFile(f)
	}
}
