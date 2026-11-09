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

func TestFiberKeywordEscapes(t *testing.T) {
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for _, retained := range []bool{false, true} {
			for _, form := range []string{"fork", "fork.in(scope)", "fork.scoped", "fork.detached", "join"} {
				word := strings.Split(form, ".")[0]
				for i := range len(word) {
					for _, extended := range []bool{false, true} {
						escaped := fmt.Sprintf("\\u%04x", word[i])
						if extended {
							escaped = fmt.Sprintf("\\u{%x}", word[i])
						}
						escaped = word[:i] + escaped + word[i+1:]
						source := "effect function f(e:any,scope:any){return " + escaped + form[len(word):] + " e}"
						t.Run(fmt.Sprintf("%s/%t/%s/%d/%t", fileName, retained, form, i, extended), func(t *testing.T) {
							file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName), VibeLangDoAsFunction: retained}, source, core.ScriptKindTS)
							ds := file.Diagnostics()
							start := strings.Index(source, escaped)
							if len(ds) != 1 || ds[0].Code() != 1260 || ds[0].Pos() != start || ds[0].End() != start+len(escaped) {
								t.Fatalf("want TS1260 on %q, got %v in %s", escaped, ds, source)
							}
						})
					}
				}
			}
		}
	}
}

func TestFiberKeywordEscapesOrdinaryNames(t *testing.T) {
	for _, word := range []string{"f\\u006frk", "j\\u006fin", "f\\u{6f}rk", "j\\u{6f}in"} {
		for _, source := range []string{
			"const " + word + "=1",
			"function f(" + word + ":(n:number)=>number){return " + word + "(1)}",
			"effect function f(){const o={" + word + "(){return 1}};return o." + word + "()}",
		} {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("ordinary name rejected: %v in %s", ds, source)
			}
		}
	}
}
