package vibelangestree

import (
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestThrowCommaSourceRequiresParentheses(t *testing.T) {
	for _, expression := range []string{"[throw e, 1]", "g(throw e, 1)", "{ a: throw e, b: 1 }", "[join throw e, 1]"} {
		for _, fileName := range []string{"main.vibe", "main.vibex"} {
			t.Run(fileName+"/"+expression, func(t *testing.T) {
				text := "effect function f(e, g) { return " + expression + "; }\n"
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName)}, text, core.ScriptKindTS)
				rejected := false
				for _, d := range file.Diagnostics() {
					rejected = rejected || d.Code() == 1010 && d.Category() == diagnostics.CategoryError
				}
				if !rejected {
					t.Fatal("ungrouped comma must report EK1010")
				}
				if _, failure := Parse(fileName, text); failure == nil {
					t.Fatal("ESTree accepted an invalid throw-comma expression")
				}
				text = strings.ReplaceAll(text, "throw e", "(throw e)")
				program := parse(t, fileName, text)
				if program["type"] != "Program" || len(find(program, "FunctionDeclaration")) == 0 {
					t.Fatal("missing function AST")
				}
			})
		}
	}
}
func TestGroupedThrowBeforeSyntaxErrorReportsActualError(t *testing.T) {
	for _, prefix := range []string{"", "const symbol = \"😀\";\r\n"} {
		for _, suffix := range []string{"const broken = ;", "module embedded { const broken = ; }"} {
			text := prefix + "effect function f(e) { return [(throw e), 1]; }\r\n" + suffix
			_, failure := Parse("main.vibe", text)
			offset := strings.Index(text, "broken = ") + len("broken = ")
			want := len(utf16.Encode([]rune(text[:offset])))
			if failure == nil || failure.Index != want || !strings.Contains(failure.Message, "Expression expected") {
				t.Fatalf("want expression error at UTF-16 offset %d; got %v", want, failure)
			}
		}
	}
}

func TestCryptoPropertyThrowGroupingProducesESTree(t *testing.T) {
	text := "export const make = (valid: boolean, badArgument: () => unknown) => ({ randomBytes: effect () => valid ? 1 : throw badArgument(), digest: 0 });\n"
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "main.vibe", PathKey: "main.vibe"}, text, core.ScriptKindTS)
	rejected := false
	for _, d := range file.Diagnostics() {
		rejected = rejected || d.Code() == 1010 && d.Category() == diagnostics.CategoryError
	}
	if !rejected {
		t.Fatal("minimized property must exercise EK1010")
	}
	if _, failure := Parse("main.vibe", text); failure == nil {
		t.Fatal("invalid property must not produce an ESTree")
	}
	text = strings.ReplaceAll(text, "throw badArgument()", "(throw badArgument())")
	parse(t, "main.vibe", text)
}
