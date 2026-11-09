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

func TestInterruptionKeywordEscapes(t *testing.T) {
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for _, retained := range []bool{false, true} {
			for _, word := range []string{"uninterruptible", "restore", "interruptible"} {
				for i := range len(word) {
					for _, extended := range []bool{false, true} {
						escape := fmt.Sprintf("\\u%04x", word[i])
						if extended {
							escape = fmt.Sprintf("\\u{%x}", word[i])
						}
						escaped := word[:i] + escape + word[i+1:]
						body := escaped + "{}"
						if word == "restore" {
							body = "uninterruptible{" + body + "}"
						}
						source := "effect function f(){" + body + "}"
						t.Run(fmt.Sprintf("%s/%t/%s/%d/%t", fileName, retained, word, i, extended), func(t *testing.T) {
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

func TestInterruptionKeywordEscapesOrdinaryNames(t *testing.T) {
	for _, word := range []string{"uninterruptible", "restore", "interruptible"} {
		escaped := word[:1] + fmt.Sprintf("\\u%04x", word[1]) + word[2:]
		for _, source := range []string{
			"const " + escaped + "=1",
			"function f(" + escaped + ":(n:number)=>number){return " + escaped + "(1)}",
			"effect function f(){const o={" + escaped + "(){return 1}};return o}",
			"function f(" + word + ":number){" + escaped + "\n{}}",
		} {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("ordinary name rejected: %v in %s", ds, source)
			}
		}
	}
}
