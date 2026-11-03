package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A source return in per-item work is VIP-19's EK1904 even when a do
// expression cannot yet be lifted. Do not replace that rejection with the
// implementation-boundary EK0204.
func (p *Parser) doConcurrentItemReturn(boundary, jump *ast.Node) bool {
	if jump.Kind != ast.KindReturnStatement {
		return false
	}
	for child, n := boundary, boundary.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsFunctionLike(n) {
			if ast.IsArrowFunction(n) && ast.IsCallExpression(n.Parent) {
				call := n.Parent
				callee := call.Expression()
				if callee.Kind == ast.KindIdentifier && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$forConcurrent" && len(call.Arguments()) == 3 && call.Arguments()[2] == n {
					return true
				}
			}
			call := n.Parent
			for call != nil && ast.IsParenthesizedExpression(call) {
				call = call.Parent
			}
			if d := p.vibelangDos[call]; d != nil && d.arrow == n {
				continue
			}
			if name := n.Name(); child == name && ast.IsComputedPropertyName(name) || ast.IsDecorator(child) {
				continue
			}
			return false
		}
		if ast.IsClassElement(n) {
			if name := n.Name(); child == name && ast.IsComputedPropertyName(name) || ast.IsDecorator(child) {
				continue
			}
			return false
		}
	}
	return false
}
