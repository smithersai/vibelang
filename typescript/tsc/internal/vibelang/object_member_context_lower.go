package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// An Effect method's body and parameters have already been lowered. Its
// computed name belongs to the context that constructs the object.
func (tx *lowering) visitObjectMemberName(node *ast.Node) *ast.Node {
	visitor := tx.EmitContext().NewNodeVisitor(nil)
	visitor.Visit = func(child *ast.Node) *ast.Node {
		if ast.IsComputedPropertyName(child) {
			return tx.visit(child)
		}
		return child
	}
	return visitor.VisitEachChild(node)
}

// Ordinary methods and accessors reset execution for their bodies; their
// computed names still evaluate in the enclosing object expression.
func (tx *lowering) visitObjectMemberBoundary(node *ast.Node, outer bool) *ast.Node {
	visitor := tx.EmitContext().NewNodeVisitor(nil)
	visitor.Visit = func(child *ast.Node) *ast.Node {
		if ast.IsComputedPropertyName(child) {
			tx.inEffect = outer
			defer func() { tx.inEffect = false }()
		}
		return tx.visit(child)
	}
	return visitor.VisitEachChild(node)
}
