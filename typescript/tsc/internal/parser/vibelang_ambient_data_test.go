package parser_test

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestAmbientSchemaDataRecovery(t *testing.T) {
	for _, form := range []struct {
		source string
		code   int32
	}{
		{"schema Row { n: number }", 1506}, {"schema Row = string", 1506}, {"data Choice { A; B { n: number } }", 1607}, {"data Choice<T> { A; B { n: T } }", 1607},
		{"schema Row", 1506}, {"data Choice", 1607}, {"data Choice<T>", 1607},
	} {
		for _, wrap := range []string{
			"declare %s", "export declare %s", "declare namespace N { %s }", "declare namespace N { export %s }", "declare namespace N.Inner { %s }", "declare module \"foreign\" { %s }", "export {}; declare global { %s }", "declare namespace N { namespace Inner { %s } }",
		} {
			source := fmt.Sprintf(wrap, form.source)
			t.Run(source, func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/ambient.vibe", PathKey: "/ambient.vibe"}, source, core.ScriptKindTS)
				ds := file.Diagnostics()
				if len(ds) != 0 {
					t.Fatalf("ambient context must not create parse recovery: %v", ds)
				}
			})
		}
	}
}

func TestAmbientSchemaDataNativeAndRuntimeControls(t *testing.T) {
	for _, source := range []string{
		"declare namespace N { const schema: number; type data = string; class Native { n: number } }",
		"declare module \"foreign\" { export const Row: number; export type Choice = string }",
		"export {}; declare global { interface Row { n: number } }",
		"namespace N { export schema Row { n: number }; export data Choice { A } }",
		"schema Row { n: number }; data Choice { A }; error Missing; schema error Bad",
		"declare const data: unknown; declare const schema: unknown; type T = number; (data as T); (data satisfies unknown); (schema as T)",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseVibe(t, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("control: %v", ds)
			}
		})
	}
	// A generated declaration remains native TypeScript, with no custom forms.
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/api.d.ts", PathKey: "/api.d.ts"}, "export declare const Row: { readonly Type: { n: number } }; export type Row = typeof Row.Type;", core.ScriptKindTS)
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("declaration counterpart: %v", ds)
	}
}
