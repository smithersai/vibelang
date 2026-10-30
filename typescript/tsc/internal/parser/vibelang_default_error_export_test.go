package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

func TestVibeLangDefaultErrorExportDiagnostic(t *testing.T) {
	for _, source := range []string{
		"export default error Missing",
		"export default error Missing { id: string }",
		"export default schema error Missing",
		"export default schema error Missing { id: string }",
		"export default error async {}",
		"export default /* comment */ error Missing {}; export const kept = 1",
		"export default\n schema error Missing {}; export const kept = 1",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			items := file.Diagnostics()
			if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != 1305 {
				t.Fatalf("want one EK1305, got %v", items)
			}
			if !ast.IsExternalModule(file) {
				t.Fatal("invalid default export lost its module boundary")
			}
			if !strings.Contains(items[0].String(), "export {") {
				t.Fatalf("missing recovery guidance: %s", items[0].String())
			}
		})
	}
}

func TestVibeLangDefaultErrorExportKeepsExpressions(t *testing.T) {
	for _, source := range []string{
		"export error Missing { id: string }",
		"export schema error Missing { id: string }",
		"error Missing; export { Missing as default }",
		"schema error Missing; export { Missing as default }",
		"const error = 1; export default error",
		"const error = 1; export default error as number",
		"const error = 1; export default error satisfies number",
		"const error = (n: number) => n; export default error(1)",
		"const error = {x:1}; export default error.x",
		"const error = 1; export default error\n; const next = 2",
		"const schema = 1; export default schema as number",
		"const error = 1; export default error\nconst next = 2",
		"const error = 1; export default error as { readonly value: string }",
		"export default schema\nerror Missing",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("valid source rejected: %v", file.Diagnostics())
			}
		})
	}
}
