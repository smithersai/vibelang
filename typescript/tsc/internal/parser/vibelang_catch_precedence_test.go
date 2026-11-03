package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestVibeLangCatchPrecedence(t *testing.T) {
	for _, expression := range []string{
		"b ?? a catch () => 1", "b || a catch () => 1", "b && a catch () => 1",
		"b ?? a catch effect () => 1", "b || a catch (() => 1)",
		"a catch function () { return 1 } ?? 2",
		"a catch function () { return 1 }.call(a)",
		"a catch function () { return [1] }[0]",
		"a catch function () { return 1 }()",
		"a catch (function () { return 1 })?.()",
		"a catch (() => 1) || 2",
		"a catch (() => 1)()",
		"a catch effect function () { return 1 } ?? 2",
	} {
		t.Run(expression, func(t *testing.T) {
			source := "effect function f() { return " + expression + " }"
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			ds := file.Diagnostics()
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 512 {
				t.Fatalf("want one EK0512 for %s; got %v", expression, ds)
			}
		})
	}
	for _, expression := range []string{
		"(b ?? a) catch () => 1", "b ?? (a catch () => 1)",
		"(b || a) catch () => 1", "(b && a) catch () => 1",
		"a catch () => b ?? 1", "a catch () => b || 1", "a catch () => b && 1",
		"a catch function () { return b ?? 1 }",
		"(a catch function () { return 1 }) ?? 2",
		"(a catch (() => 1)) || 2", "(a catch function () { return [1] })[0]",
		"a catch (function () { return 1 })",
		"a catch (effect function () { return 1 })",
		"a catch (() => 1) catch (() => 2)",
		"a catch (() => 1) ? 2 : 3",
		"holder[b || a] catch () => 1", "make(b ?? a) catch () => 1",
	} {
		t.Run("control/"+expression, func(t *testing.T) {
			source := "effect function f() { return " + expression + " }"
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("valid syntax rejected: %v", ds)
			}
		})
	}
}

// A synthesized arrow in the recovery tree is not a source function literal.
// These nonliteral handlers belong to EK0509 in the checker, not EK0512.
func TestVibeLangCatchPrecedenceSyntheticHandlers(t *testing.T) {
	for _, handler := range []string{"effect { return 9 }", "(effect { return 9 })", `throw new Error("failure")`, `(throw new Error("failure"))`} {
		source := "effect function f() { return task catch " + handler + " }"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		for _, d := range file.Diagnostics() {
			if d.Source() == "EK" && d.Code() == 512 {
				t.Fatalf("synthetic handler got EK0512: %s", handler)
			}
		}
	}
}
