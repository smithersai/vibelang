package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestDataMalformedVariantPayloadRecovery(t *testing.T) {
	names := []string{"\"Quoted\"", "'Quoted'", "1", "1n", string(rune(96)) + "Quoted" + string(rune(96))}
	payloads := []string{"{}", "{ value: number }", "{ nested: { text:string; more:{flag:boolean} }; tuple:[number,{tag:\"x\"}] }", "{ run:(input:{x:number})=>{result:string}; list:readonly (number|string)[] }", "(value: number)", "(run: (input: { x: number }) => void)"}
	gaps := []string{" ", "\n", " /* payload */\r\n"}
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for i, name := range names {
			for j, payload := range payloads {
				for k, gap := range gaps {
					t.Run(fmt.Sprintf("%s/name%d/payload%d/gap%d", fileName, i, j, k), func(t *testing.T) {
						source := "data Bad { " + name + gap + payload + "; Good { value:number } }; data After { Ready }; const tail=1;"
						file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
						ds := file.Diagnostics()
						if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1606 {
							t.Errorf("one malformed name needs only EK1606: %v", ds)
						}
						if len(ds) > 0 {
							at := strings.Index(source, name)
							if ds[0].Pos() != at || ds[0].Len() != len(name) {
								t.Fatalf("diagnostic range %d+%d, want %d+%d", ds[0].Pos(), ds[0].Len(), at, len(name))
							}
						}
						found := map[string]bool{}
						for _, form := range forms {
							if form.Name == parser.VibeSyntaxData {
								for _, v := range form.Variants {
									found[source[v.Name.Pos():v.Name.End()]] = true
								}
							}
						}
						if len(found) != 2 || !found["Good"] || !found["Ready"] {
							t.Fatalf("following variants lost: %v", found)
						}
					})
				}
			}
		}
	}
}
