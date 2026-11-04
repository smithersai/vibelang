package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestCov2VIP41ThrowStatementOperandAndNewline(t *testing.T) {
	// rule-evidence: docs/design/vips/0041-throw-expressions.md#7ddf5349e5d1ca27
	// VIP-41: throw statement full operand and no-line-terminator restriction.
	for _, source := range []string{
		"function f() { throw a + b; }",
		"function f() { throw a, b; }",
	} {
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("full statement operand rejected: %q: %v", source, ds)
		}
		statements := file.Statements.Nodes[0].AsFunctionDeclaration().Body.AsBlock().Statements.Nodes
		if len(statements) != 1 || statements[0].Kind != ast.KindThrowStatement {
			t.Fatalf("statement-position throw lost its native node: %q", source)
		}
		if operand := statements[0].AsThrowStatement().Expression; operand.Kind != ast.KindBinaryExpression {
			t.Fatalf("throw must consume the whole binary/comma operand: %q, kind=%v", source, operand.Kind)
		}
	}
	source := "function f() { throw\nvalue; }"
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	// parseThrowStatement deliberately defers TS1142 to the grammar walker.
	// Pin its actual contract: the newline cannot become a throw operand.
	if ds := file.Diagnostics(); len(ds) != 0 {
		t.Fatalf("newline recovery unexpectedly reported a parser diagnostic: %v", ds)
	}
	statements := file.Statements.Nodes[0].AsFunctionDeclaration().Body.AsBlock().Statements.Nodes
	if len(statements) != 2 || statements[0].Kind != ast.KindThrowStatement || statements[1].Kind != ast.KindExpressionStatement {
		t.Fatalf("newline must leave a throw and a separate expression statement: %v", statements)
	}
	operand := statements[0].AsThrowStatement().Expression
	if operand == nil || !ast.IsIdentifier(operand) || operand.Text() != "" {
		t.Fatalf("newline must leave the missing identifier consumed by the TS1142 grammar check: %v", operand)
	}
	next := statements[1].AsExpressionStatement().Expression
	if !ast.IsIdentifier(next) || next.Text() != "value" {
		t.Fatalf("the next line was consumed as a throw operand: %v", next)
	}
}
