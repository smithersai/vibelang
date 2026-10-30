package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestEffectOptionalMethods(t *testing.T) {
	for _, source := range []string{
		`class C { effect read?() { return 1 } }`,
		`class C { effect read?<T>(x: T) { return x } }`,
		`class C { effect ["read"]?() { return 1 } }`,
	} {
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
		if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
			t.Fatalf("optional effect method rejected: %v\n%s", diagnostics, source)
		}
		method := file.Statements.Nodes[0].Members()[0]
		if method.Kind != ast.KindMethodDeclaration || method.Flags&ast.NodeFlagsVibeLangEffect == 0 || method.AsMethodDeclaration().PostfixToken == nil {
			t.Fatalf("lost optional effect method: %s", source)
		}
	}
}
