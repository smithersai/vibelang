package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestVibeLangCatchMissingArrowDiagnostic(t *testing.T) {
	for _, head := range []string{"(e)", "()", "(e: string)", "<E>(e: E)", "effect (e)", "async (e)"} {
		for _, gap := range []string{" ", " /* gap */ ", "\n", "\r\n"} {
			t.Run(head+gap, func(t *testing.T) {
				source := "effect function f() { return try x catch " + head + gap + "{ return 0 } }"
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
				ds := file.Diagnostics()
				if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 509 {
					t.Fatalf("want only EK0509, got %v", ds)
				}
				if got := source[ds[0].Pos():ds[0].End()]; got != head+gap+"{ return 0 }" {
					t.Fatalf("diagnostic range covers %q", got)
				}
			})
		}
	}
}

func TestVibeLangCatchMissingArrowKeepsNativeErrors(t *testing.T) {
	for _, source := range []string{
		"effect function f() { return x catch (e) { const = 1; return 0 } }",
		"effect function f() { return x catch (e) => { const nested = (x) { return x }; return 0 } }",
		"const f = (e) { return 0 }",
	} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		native := false
		for _, d := range file.Diagnostics() {
			native = native || d.Source() != "EK"
		}
		if !native {
			t.Fatalf("lost native syntax error: %s: %v", source, file.Diagnostics())
		}
		if strings.Contains(source, "const f") && len(file.Diagnostics()) != 1 {
			t.Fatalf("native recovery changed: %v", file.Diagnostics())
		}
	}
}

func TestVibeLangCatchMissingArrowKeepsParameterDiagnostics(t *testing.T) {
	for _, head := range []string{"(e: string", "(e = 1", "<E>(e: E", "(e: string, rest: number"} {
		for _, gap := range []string{" ", " /* gap */ ", "\n", "\r\n"} {
			t.Run(head+gap, func(t *testing.T) {
				source := "effect function f() { return x catch " + head + gap + "{ return 0 } }"
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
				if len(file.Diagnostics()) == 0 {
					t.Fatal("missing native parameter-list diagnostics")
				}
				for _, d := range file.Diagnostics() {
					if d.Source() == "EK" {
						t.Fatalf("native parameter-list error was reassigned to catch: %v", file.Diagnostics())
					}
				}
			})
		}
	}
}
