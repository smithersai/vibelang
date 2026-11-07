package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Only value-producing branches can pass a literal to an enclosing call.
// Conditions, logical-and left operands and comma left operands do not.
func callbackValueParent(node *ast.Node) *ast.Node {
	parent := node.Parent
	if parent == nil {
		return nil
	}
	if ast.IsParenthesizedExpression(parent) {
		return parent
	}
	if ast.IsConditionalExpression(parent) {
		value := parent.AsConditionalExpression()
		if value.WhenTrue == node || value.WhenFalse == node {
			return parent
		}
	}
	if ast.IsBinaryExpression(parent) {
		value := parent.AsBinaryExpression()
		switch value.OperatorToken.Kind {
		case ast.KindBarBarToken, ast.KindQuestionQuestionToken:
			return parent
		case ast.KindAmpersandAmpersandToken, ast.KindCommaToken:
			if value.Right == node {
				return parent
			}
		}
	}
	return nil
}

func inlineCallbackLiterals(node *ast.Node) []*ast.Node {
	node = ast.SkipParentheses(node)
	if node == nil {
		return nil
	}
	if ast.IsFunctionExpressionOrArrowFunction(node) {
		return []*ast.Node{node}
	}
	if ast.IsConditionalExpression(node) {
		value := node.AsConditionalExpression()
		return append(inlineCallbackLiterals(value.WhenTrue), inlineCallbackLiterals(value.WhenFalse)...)
	}
	if ast.IsBinaryExpression(node) {
		value := node.AsBinaryExpression()
		switch value.OperatorToken.Kind {
		case ast.KindBarBarToken, ast.KindQuestionQuestionToken:
			return append(inlineCallbackLiterals(value.Left), inlineCallbackLiterals(value.Right)...)
		case ast.KindAmpersandAmpersandToken, ast.KindCommaToken:
			return inlineCallbackLiterals(value.Right)
		}
	}
	return nil
}
