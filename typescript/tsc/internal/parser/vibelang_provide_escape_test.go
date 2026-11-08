package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestProvideKeywordEscapes(t *testing.T) {
	for _, word := range []string{`\u0070rovide`, `pr\u006fvide`, `provid\u0065`, `\u{70}rovide`} {
		for _, body := range []string{"%s Layer.empty {}", "effect function f(){%s Layer.empty {}}", "function f(){%s Layer.empty {}}"} {
			t.Run(word+"/"+body, func(t *testing.T) {
				source := strings.Replace(body, "%s", word, 1)
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				diagnostics := file.Diagnostics()
				if len(diagnostics) != 1 || diagnostics[0].Code() != 1260 {
					t.Fatalf("escaped keyword: want TS1260, got %v", diagnostics)
				}
			})
		}
		for _, source := range []string{
			"const " + word + "=1;export{" + word + "};",
			"function f(" + word + ":(n:number)=>number){return " + word + "(1)}",
			"function f(" + word + ":number,a:number){return " + word + " / a / {n:2}.n}",
			"function f(" + word + ":number){" + word + "\nvalue\n{}}",
		} {
			t.Run("identifier/"+source, func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				if len(file.Diagnostics()) != 0 {
					t.Fatalf("ordinary escaped identifier rejected: %v", file.Diagnostics())
				}
			})
		}
	}
}
