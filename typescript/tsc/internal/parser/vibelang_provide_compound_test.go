package parser_test

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestProvideCompoundAssignments(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/provider-compound-assignments.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Key, Head string
		Provide   bool
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		for _, ext := range []string{"vibe", "vibex"} {
			for _, prefix := range []string{"function", "effect function"} {
				t.Run(row.Key+"/"+ext+"/"+prefix, func(t *testing.T) {
					source := prefix + " f(){ provide " + row.Head + " {} }"
					name := "/main." + ext
					file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source)
					count := 0
					for _, form := range forms {
						if form.Kind == parser.VibeSyntaxBlockStatement && source[form.Word.Pos():form.Word.End()] == "provide" {
							count++
						}
					}
					if (count == 1) != row.Provide || count > 1 {
						t.Fatalf("want provide=%t, got %d recorded forms; source=%s", row.Provide, count, source)
					}
					codes := func(f *ast.SourceFile) []int32 {
						var values []int32
						for _, d := range f.Diagnostics() {
							values = append(values, d.Code())
						}
						slices.Sort(values)
						return values
					}
					if row.Provide {
						if got := codes(file); len(got) != 0 {
							t.Fatalf("valid provider rejected: %v; source=%s", got, source)
						}
						return
					}
					kind, nativeName := core.ScriptKindTS, "/main.ts"
					if ext == "vibex" {
						kind, nativeName = core.ScriptKindTSX, "/main.tsx"
					}
					nativeSource := strings.Replace(source, "effect function", "function", 1)
					native := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(nativeName), PathKey: tspath.PathKey(nativeName)}, nativeSource, kind)
					got, want := codes(file), codes(native)
					if len(want) == 0 || !slices.Equal(got, want) {
						t.Fatal(fmt.Sprintf("identifier syntax changed: got %v; native %v; source=%s", got, want, source))
					}
				})
			}
		}
	}
}
