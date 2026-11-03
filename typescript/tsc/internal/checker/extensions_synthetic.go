package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// CheckSyntheticExpression checks an extension's detached native counterpart
// with ordinary diagnostics, not the type-only mode of GetTypeAtLocation.
func (c *Checker) CheckSyntheticExpression(node *ast.Node) *Type {
	return c.checkExpression(node)
}
