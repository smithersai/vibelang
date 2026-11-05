package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Add native cleanup only after visiting source Effect syntax. Failed yields
// leave these native finally blocks suspended, as Effect.gen requires.
func (tx *lowering) visitMatchCacheBlock(node *ast.Node, names []*ast.Node) *ast.Node {
	f := tx.Factory()
	var declarations, body []*ast.Node
	for _, statement := range node.Statements() {
		value := tx.visit(statement)
		// Lowering erases checked no-match assertions and TypeScript-only
		// declarations. An executable statement list cannot retain nil entries.
		if value == nil {
			continue
		}
		if parser.VibeLangMatchCacheDeclaration(statement) != nil {
			declarations = append(declarations, value)
		} else {
			body = append(body, value)
		}
	}
	for i := len(names) - 1; i >= 0; i-- {
		name := names[i]
		method := func(word string, args ...*ast.Node) *ast.Node {
			member := f.NewPropertyAccessExpression(name, nil, f.NewIdentifier(word), ast.NodeFlagsNone)
			return f.NewExpressionStatement(f.NewCallExpression(member, nil, nil, f.NewNodeList(args), ast.NodeFlagsNone))
		}
		thrown := f.NewUniqueName("matchError")
		handler := f.NewCatchClause(f.NewVariableDeclaration(thrown, nil, nil, nil), f.NewBlock(f.NewNodeList([]*ast.Node{method("threw", thrown), f.NewThrowStatement(thrown)}), true))
		finish := f.NewBlock(f.NewNodeList([]*ast.Node{method("finish")}), true)
		body = []*ast.Node{f.NewTryStatement(f.NewBlock(f.NewNodeList(body), true), handler, finish)}
	}
	return f.UpdateBlock(node.AsBlock(), f.NewNodeList(append(declarations, body...)), node.AsBlock().MultiLine)
}

// The checker must retain assignment flow through the condition's && chain.
// Add the false-path cleanup only to native output, after visiting Effect
// syntax, so the expression stays in its original activation.
func (tx *lowering) visitMatchCacheCondition(node, name *ast.Node) *ast.Node {
	f := tx.Factory()
	value := tx.Visitor().VisitEachChild(node)
	member := f.NewPropertyAccessExpression(name, nil, f.NewIdentifier("finish"), ast.NodeFlagsNone)
	finish := f.NewCallExpression(member, nil, nil, f.NewNodeList(nil), ast.NodeFlagsNone)
	miss := f.NewParenthesizedExpression(f.NewBinaryExpression(nil, finish, nil, f.NewToken(ast.KindCommaToken), f.NewKeywordExpression(ast.KindFalseKeyword)))
	result := f.NewParenthesizedExpression(f.NewBinaryExpression(nil, value, nil, f.NewToken(ast.KindBarBarToken), miss))
	tx.EmitContext().SetOriginal(result, node)
	result.Loc = node.Loc
	return result
}
