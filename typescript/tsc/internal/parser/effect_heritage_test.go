package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestEffectHeritageBody(t *testing.T) {
	for _, source := range []string{
		"class C extends effect {}",
		"class C extends \\u0065ffect {}",
		"const C = class extends effect {}",
		"class C extends effect { effect read() { return 1 } }",
		"class C extends effect\n{}",
		"class C implements effect {}",
		"interface C extends effect {}",
		"class C extends (class { program = effect { return 1 } }) {}",
		"class C extends choose(effect { return 1 }) {}",
	} {
		t.Run(source, func(t *testing.T) {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
			if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
				t.Fatalf("class body consumed by effect block: %v\n%s", diagnostics, source)
			}
		})
	}
}
