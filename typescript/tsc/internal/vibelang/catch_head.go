package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A catch protects only the Effect produced by its head. Source execution
// in that head belongs to the surrounding activation, before recovery starts.
// Parenthesized try heads retain their separate operand-type path for now.
func inlineCatchLeft(fn *ast.Node) bool {
	return fn != nil && isCatchLeftFunction(fn) && fn.Body() != nil && !isTry(ast.SkipParentheses(fn.Body()))
}

func inlineCatchHead(node *ast.Node) bool {
	if !isCatchLeftBody(node) {
		return false
	}
	fn := node.Parent
	for fn != nil && ast.IsParenthesizedExpression(fn) {
		fn = fn.Parent
	}
	return inlineCatchLeft(fn)
}

func inlineCatchOperandType(c *checker.Checker, call *ast.Node) *checker.Type {
	// The generated function is marked effect so lowering can evaluate its
	// head in place. Its signature can wrap the body's value in an Effect;
	// the operand check reads the source head before that synthetic wrapper.
	return catchOperandType(c, call.Arguments()[0].Body())
}
