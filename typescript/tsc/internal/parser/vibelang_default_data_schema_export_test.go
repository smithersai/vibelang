package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestVibeLangDefaultDataSchemaExportDiagnostic(t *testing.T) {
	for _, c := range []struct {
		source string
		code   int32
	}{
		{"export default schema User { name: string }", 1501},
		{"export default schema User = string", 1501},
		{"export default schema error { name: string }", 1501},
		{"export default schema as = string", 1501},
		{"export default data Value { One }", 1603},
		{"export default data Value<T> { One { value: T } }", 1603},
		{"export default data async { One }", 1603},
		{"export default /* gap */ schema User { name: string }; export const kept = 1", 1501},
		{"export default\n data Value { One }; export const kept = 1", 1603},
		{"export default schema /* name */ User = string; export const kept = 1", 1501},
		{"export default schema error Missing { name: string }", 1305},
		{"export default error Missing { name: string }", 1305},
		{"export default service Missing { name: string }", 905},
	} {
		t.Run(c.source, func(t *testing.T) {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, c.source)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != c.code {
				t.Fatalf("want only EK%04d, got %v", c.code, ds)
			}
			if !ast.IsExternalModule(file) {
				t.Fatal("lost module boundary")
			}
		})
	}
}

func TestVibeLangDefaultDataSchemaExportKeepsExpressions(t *testing.T) {
	for _, word := range []string{"schema", "data"} {
		for _, tail := range []string{"", " as number", " satisfies number", "(1)", ".value", "\nconst next = 2", "\n; const next = 2", " as { readonly value: string }"} {
			source := "export default " + word + tail
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if len(file.Diagnostics()) != 0 {
				t.Errorf("%s: %v", source, file.Diagnostics())
			}
		}
	}
	for _, source := range []string{"export schema User {name:string}", "schema User = string; export {User as default}", "data Value {One}; export {Value as default}"} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if len(file.Diagnostics()) != 0 {
			t.Errorf("%s: %v", source, file.Diagnostics())
		}
	}
}
