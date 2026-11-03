package parser_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestSchemaTypeParameterAdmissionDiagnostic(t *testing.T) {
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for _, source := range []string{
			"schema User<T> {name:string}",
			"schema User<T> = string",
			"export schema User<T, U> {name:string}",
			"schema User<T extends {value: [string, number]}> {name:string}",
			"schema User<T = string> = number",
			"schema User<const T> {name:string}",
			"schema User<in T, out U> {name:string}",
			"schema error<T> {name:string}",
			"schema error<T> = string",
			"schema User\n<T> {name:string}",
			"schema User /* before */ <T> /* after */ {name:string}; export const kept = 1",
			"function f() { schema Local<T> {name:string}; return 0 }",
		} {
			t.Run(fileName+"/"+source, func(t *testing.T) {
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
				ds := file.Diagnostics()
				if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1502 {
					t.Fatalf("want only EK1502, got %v", ds)
				}
			})
		}
	}
}

func TestSchemaTypeParameterAdmissionKeepsNativeGenerics(t *testing.T) {
	for _, source := range []string{
		"schema User {name:string}",
		"schema User = string",
		"data Value<T> {One {value:T}}",
		"schema error Failure<T> {value:T}",
		"function factory<T>(value:T) { return value }",
		"schema User {name:string}\n<T,>(value:T) => value",
		"const schema = <T>(value:T) => value; const result = schema(1)",
		"function f<T>() { schema Local {name:string}; return Local }",
	} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if len(file.Diagnostics()) != 0 {
			t.Errorf("%s: %v", source, file.Diagnostics())
		}
	}
}
