package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

// VIP-3 excludes parser-only JSDoc operands. EK0301 diagnoses written
// compound operands; a closed recovered function head without an arrow is not one.
func TestEffectSlotRecoveryDoesNotInventCompoundError(t *testing.T) {
	for _, c := range []struct {
		name, text       string
		compound, syntax bool
	}{
		{"postfix-optional-recovery", "number!!(string?)", false, true},
		{"named-optional-recovery", "number!!(x?)", false, true},
		{"double-parenthesized-recovery", "number!!((string?))", false, true},
		{"nested-arrow-recovery", "number!!(x: () => string)", false, true},
		{"written-function", "number!!(x: string) => string", true, false},
		{"written-constructor", "number!!new (x: string) => Error", true, false},
		{"grouped-function", "number!!((x: string) => string)", false, false},
		{"grouped-constructor", "number!!(new (x: string) => Error)", false, false},
		{"written-function-missing-return", "number!!(x: string) =>", true, true},
		{"written-function-missing-close", "number!!(x: string => string", true, true},
		{"written-union-missing-member", "number!!string |", true, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			text := "type T = " + c.text + "\nexport {}\n"
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, text, core.ScriptKindTS)
			compound, syntax := false, false
			for _, d := range file.Diagnostics() {
				if d.Source() == "EK" && d.Code() == 301 {
					compound = true
				}
				if d.Source() != "EK" {
					syntax = true
				}
			}
			if compound != c.compound || syntax != c.syntax {
				t.Errorf("compound=%t syntax=%t; want compound=%t syntax=%t; diagnostics=%v", compound, syntax, c.compound, c.syntax, file.Diagnostics())
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if n.Kind == ast.KindFunctionType || n.Kind == ast.KindConstructorType {
						result := n.Type()
						detail := "nil"
						if result != nil {
							detail = result.Kind.String()
						}
						t.Logf("callable kind=%v flags=%v span=%d:%d parameterEnd=%d result=%s", n.Kind, n.Flags, n.Pos(), n.End(), n.ParameterList().End(), detail)
					}
					return n.ForEachChild(visit)
				}
				file.AsNode().ForEachChild(visit)
			}
		})
	}
}
