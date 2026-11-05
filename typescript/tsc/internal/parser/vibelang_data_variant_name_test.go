package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestDataMalformedVariantNames(t *testing.T) {
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for _, row := range []struct {
			name    string
			invalid bool
		}{
			{"\"Quoted\"", true}, {"'Quoted'", true}, {"1", true}, {"1n", true}, {"`Quoted`", true},
			{"Value", false}, {"default", false}, {"null", false}, {"class", false}, {"V\\u0061lue", false},
		} {
			t.Run(fileName+"/"+row.name, func(t *testing.T) {
				source := "data Bad { " + row.name + "; Good }; data After { Ready }; const tail=1;"
				file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
				ds := file.Diagnostics()
				if row.invalid {
					if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1606 {
						t.Fatalf("malformed variant needs only EK1606: %v", ds)
					}
					at := strings.Index(source, row.name)
					if ds[0].Pos() != at || ds[0].Len() != len(row.name) {
						t.Fatalf("diagnostic range %d+%d, want %d+%d", ds[0].Pos(), ds[0].Len(), at, len(row.name))
					}
				} else if len(ds) != 0 {
					t.Fatalf("IdentifierName variant: %v", ds)
				}
				found := map[string]bool{}
				for _, form := range forms {
					if form.Name == parser.VibeSyntaxData {
						for _, variant := range form.Variants {
							found[source[variant.Name.Pos():variant.Name.End()]] = true
						}
					}
				}
				if !found["Good"] || !found["Ready"] {
					t.Fatalf("following variants lost: %v", found)
				}
			})
		}
	}
}
