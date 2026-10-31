package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangDataDeclarationErrors(t *testing.T) {
	for source, code := range map[string]int32{
		"export default schema S { a: string }":          1501,
		"export default schema S = string":               1501,
		"export default schema S\nconst next = 1":        1501,
		"export default data D { A; B }":                 1603,
		"export default data D<A> { Some { value: A } }": 1603,
		"schema S<A> { a: string }":                      1502,
		"schema S<A extends string, B> { a: string }":    1502,
		"export schema S<A> = string\nconst next = 1":    1502,
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			items := file.Diagnostics()
			if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != code {
				t.Fatalf("want one EK%04d, got %v", code, items)
			}
		})
	}
}

func TestVibeLangDefaultExportKeepsExpressions(t *testing.T) {
	for _, source := range []string{
		"const schema = 1; export default schema",
		"const schema = 1; export default schema as number",
		"const schema = 1; export default schema satisfies number",
		"const data = 1; export default data",
		"const data = 1; export default data as number",
		"const data = 1; export default data satisfies number",
		"const data = [1]; export default data[0]",
		"schema S { a: string }\nexport { S as default }",
		"data D { A; B }\nexport { D as default }",
		"export schema S { a: string }",
		"export data D<A> { Some { value: A } }",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("a valid form was rejected: %v", file.Diagnostics())
			}
		})
	}
}
