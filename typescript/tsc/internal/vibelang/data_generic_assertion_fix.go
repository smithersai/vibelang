package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	// Native recovery reports TS1005 until the missing-data-body diagnostic
	// owns this header. Opt in only the narrowly selected assertion below.
	nativeFixCodes = append(nativeFixCodes, 1005)
	tsFormFixCodes = append(tsFormFixCodes, 1005)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 1005)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes: []int32{1005},
		GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			var changes []*lsproto.TextEdit
			for _, e := range dataGenericAssertionEdits(fix.SourceFile, fix.Span) {
				changes = append(changes, replaceRange(fix, e.start, e.end, e.text)...)
			}
			if len(changes) == 0 {
				return nil, nil
			}
			return []*ls.CodeAction{{Description: "Preserve the data assertion with parentheses", Changes: changes}}, nil
		},
	})
}

// A statement-start data as/satisfies followed by a next-line generic function
// type was an expression under the old lookahead. Parse its TypeScript twin,
// then parenthesize the whole original expression, including any outer operators.
// No token, comment, type or evaluation moves.
func dataGenericAssertionEdits(file *ast.SourceFile, span core.TextRange) []sourceEdit {
	if file == nil || !isVibeLangFile(file) {
		return nil
	}
	ts := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/data-assertion.ts", PathKey: "/data-assertion.ts"}, file.Text(), file.ScriptKind)
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ast.IsExpressionStatement(node) {
			return node.ForEachChild(visit)
		}
		expression := node.Expression()
		start, end := nodeStart(ts, expression), expression.End()
		if span.Pos() < start || span.End() > end {
			return false
		}
		for _, d := range ts.Diagnostics() {
			if d.Pos() >= start && d.Pos() <= end {
				return false
			}
		}
		var prefix func(*ast.Node) bool
		prefix = func(n *ast.Node) bool {
			if nodeStart(ts, n) != start {
				return false
			}
			if n.Kind == ast.KindAsExpression || n.Kind == ast.KindSatisfiesExpression {
				operand, typ := n.Expression(), n.Type()
				if ast.IsIdentifier(operand) && operand.Text() == "data" &&
					typ.Kind == ast.KindFunctionType && typ.TypeParameters() != nil &&
					strings.ContainsAny(file.Text()[operand.End():nodeStart(ts, typ)], "\r\n\u2028\u2029") {
					return true
				}
			}
			return n.ForEachChild(prefix)
		}
		if !prefix(expression) {
			return false
		}
		edits = []sourceEdit{{start, start, "("}, {end, end, ")"}}
		return true
	}
	ts.AsNode().ForEachChild(visit)
	return edits
}
