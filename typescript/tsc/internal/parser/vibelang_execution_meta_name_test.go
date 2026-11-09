package parser_test

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestExecutionMetaNameEscapes(t *testing.T) {
	for _, ext := range []string{"vibe", "vibex"} {
		for _, retained := range []bool{false, true} {
			for _, form := range []string{"try.all", "try.race", "try.any", "try.allSettled", "fork.in", "fork.scoped", "fork.detached"} {
				parts := strings.Split(form, ".")
				word := parts[1]
				for i := range len(word) {
					for _, extended := range []bool{false, true} {
						escaped := fmt.Sprintf("\\u%04x", word[i])
						if extended {
							escaped = fmt.Sprintf("\\u{%x}", word[i])
						}
						escaped = word[:i] + escaped + word[i+1:]
						suffix := " []"
						if parts[0] == "fork" {
							suffix = " e"
						}
						if word == "in" {
							suffix = "(scope) e"
						}
						source := "effect function f(e:any,scope:any){return " + parts[0] + "." + escaped + suffix + "}"
						t.Run(fmt.Sprintf("%s/%t/%s/%d/%t", ext, retained, form, i, extended), func(t *testing.T) {
							fileName := "/main." + ext
							file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName), VibeLangDoAsFunction: retained}, source, core.ScriptKindTS)
							if ds := file.Diagnostics(); len(ds) != 0 {
								t.Fatalf("meta name must retain IdentifierName escapes: got %v in %s", ds, source)
							}
						})
					}
				}
			}
		}
	}
}

func TestExecutionMetaNameEscapesUnknownNames(t *testing.T) {
	for _, owner := range []string{"try", "fork"} {
		for _, name := range []string{"await", "yield", "new", "never", "other"} {
			plain := "effect function f(e:any){return " + owner + "." + name + " e}"
			escaped := strings.Replace(plain, "."+name, ".\\"+"u"+fmt.Sprintf("%04x", name[0])+name[1:], 1)
			codes := func(source string) []int32 {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
				var ds []int32
				for _, d := range file.Diagnostics() {
					ds = append(ds, d.Code())
				}
				return ds
			}
			got, want := codes(escaped), codes(plain)
			expected := int32(1803)
			if owner == "fork" {
				expected = 1705
			}
			if len(want) != 1 || want[0] != expected || !slices.Equal(got, want) {
				t.Fatalf("unknown meta name diagnostics: got %v want %v in %s", got, want, escaped)
			}
		}
	}
}
