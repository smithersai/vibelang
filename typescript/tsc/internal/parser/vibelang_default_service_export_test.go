package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangDefaultServiceExportDiagnostic(t *testing.T) {
	for _, source := range []string{
		"export default service Missing { value: number }",
		"export default service Missing {}",
		"export default service async {}",
		"export default /* comment */ service Missing {}; export const kept = 1",
		"export default\n service Missing {}; export const kept = 1",
		"export default service /* name */ Missing { value: number }; export const kept = 1",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			items := file.Diagnostics()
			if len(items) != 1 || items[0].Source() != "EK" || items[0].Code() != 905 {
				t.Fatalf("want one EK0905, got %v", items)
			}
			if !ast.IsExternalModule(file) {
				t.Fatal("invalid default export lost its module boundary")
			}
			if !strings.Contains(items[0].String(), "export {") {
				t.Fatalf("missing repair guidance: %s", items[0].String())
			}
		})
	}
}

func TestVibeLangDefaultServiceExportKeepsExpressions(t *testing.T) {
	for _, source := range []string{
		"export service Missing { value: number }",
		"service Missing {}; export { Missing as default }",
		"const service = 1; export default service",
		"const service = 1; export default service as number",
		"const service = 1; export default service satisfies number",
		"const service = (n: number) => n; export default service(1)",
		"const service = { value: 1 }; export default service.value",
		"const service = 1; export default service\nconst next = 2",
		"const service = 1; export default service\n; const next = 2",
		"const service = 1; export default service as { readonly value: string }",
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Fatalf("valid contextual expression or named export rejected: %v", file.Diagnostics())
			}
		})
	}
}
