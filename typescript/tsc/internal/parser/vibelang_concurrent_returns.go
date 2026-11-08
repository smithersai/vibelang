package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A forbidden source jump in per-item work keeps VIP-19's diagnostic even
// when its do expression cannot yet be lifted. Class definition expressions
// keep their surrounding item; written callable bodies do not.
func (p *Parser) doConcurrentItemJump(boundary, jump *ast.Node) bool {
	if jump.Kind != ast.KindReturnStatement && !ast.IsBreakOrContinueStatement(jump) {
		return false
	}
	if jump.Kind == ast.KindContinueStatement && jump.Label() == nil {
		return false
	}
	var item *ast.Node
	for child, n := boundary, boundary.Parent; n != nil; child, n = n, n.Parent {
		// A nested stream item owns its own outward jumps.
		if jump.Kind != ast.KindReturnStatement && n.Kind == ast.KindForOfStatement && n.Flags&ast.NodeFlagsVibeLang != 0 {
			return false
		}
		if ast.IsFunctionLike(n) {
			if ast.IsArrowFunction(n) && ast.IsCallExpression(n.Parent) {
				call := n.Parent
				callee := call.Expression()
				if callee.Kind == ast.KindIdentifier && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$forConcurrent" && len(call.Arguments()) == 3 && call.Arguments()[2] == n {
					item = n
					break
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
	if item == nil {
		return false
	}
	if jump.Kind == ast.KindReturnStatement {
		return true
	}
	outside := false
	for child, n := jump, jump.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsFunctionLike(n) {
			if ast.IsArrowFunction(n) && ast.IsCallExpression(n.Parent) {
				call := n.Parent
				callee := call.Expression()
				if callee.Kind == ast.KindIdentifier && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$forConcurrent" && len(call.Arguments()) == 3 && call.Arguments()[2] == n {
					if n == item {
						outside = true
						if jump.Label() == nil {
							return true
						}
					}
					continue
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
		if jump.Label() == nil {
			if ast.IsIterationStatement(n, false) || n.Kind == ast.KindSwitchStatement {
				return false
			}
			continue
		}
		if n.Kind != ast.KindLabeledStatement || n.Label().Text() != jump.Label().Text() {
			continue
		}
		target := n.Statement()
		for target != nil && ast.IsLabeledStatement(target) {
			target = target.Statement()
		}
		// The native binder cannot see through a retained do arrow.
		// Preserve the resolved source reference, as for rewritten continues.
		if jump.Kind == ast.KindBreakStatement {
			n.Label().Flags |= ast.NodeFlagsVibeLang
			return outside
		}
		if call := VibeLangConcurrentCall(target); call != nil {
			n.Label().Flags |= ast.NodeFlagsVibeLang
			return outside && call != item.Parent
		}
		if ast.IsIterationStatement(target, false) {
			n.Label().Flags |= ast.NodeFlagsVibeLang
			return outside
		}
		return false
	}
	return false
}
