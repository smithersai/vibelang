package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// moduleCall visits cold call arguments with the same by-name rules as a
// body call, without running the enclosing module-level call itself.
func (p *projector) moduleCall(call *ast.Node, e env) {
	// D152 also applies to cold calls and plain callbacks outside a hatch.
	// Inside its TypeScript island, keep JavaScript member semantics (D148).
	_, island := p.forms.(*Resolver).inHatch(call)
	parent := call.Parent
	if !island && !(parent != nil && p.isHatchCall(parent) && len(parent.Arguments()) > 0 && parent.Arguments()[0] == call) && p.dataMethod(call, e) {
		return
	}
	p.visit(call.Expression(), e)
	p.visitList(call.TypeArguments(), e)
	p.callArguments(call, e)
}

// holdsProgram recognizes declared consts (D269) and fields (D265) without a
// checker, using the same parameter, declared-type, and service shapes as
// lambda form resolution. Only the initializer call is cold; its operands
// keep the surrounding evaluation rules.
func (r *Resolver) holdsProgram(expr *ast.Node) bool {
	if decl := HeldConstDeclaration(expr); decl != nil {
		return r.factoryEffectType(decl.Type(), 0) != nil
	}
	node := expr
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	field := node.Parent
	if field == nil || !ast.IsPropertyAssignment(field) || field.Initializer() != node {
		return false
	}
	if d := r.Argument(node); d.Class == ClassProgram {
		return true
	}
	if cls, _, ok := r.annotatedMember(node); ok && cls == ClassProgram {
		return true
	}
	cls, _, ok := r.serviceMember(node)
	return ok && cls == ClassProgram
}

// HeldConstDeclaration returns the const declaration with a declared type
// whose initializer is expr (D269), or nil. Parentheses, a type assertion, a
// satisfies clause and a non-null assertion leave the initializer's value as
// it is, so expr may stand inside them. A conditional's value is one of its
// branches, so expr may also be a branch, though never the condition, which
// the conditional evaluates to choose the branch. A pipe's value is its body's
// (D154), so expr may also be a pipe's body, though never its left side: the
// body builds the program and the left side keeps its parameter position.
// The caller decides whether the declared type is an Effect.
func HeldConstDeclaration(expr *ast.Node) *ast.Node {
	// An explicit try supplies its success, even when that success is an Effect.
	if expr.Flags&ast.NodeFlagsVibeLangTry != 0 {
		return nil
	}
	node := expr
	for parent := node.Parent; parent != nil; parent = node.Parent {
		if parent.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return nil
		}
		if ast.IsOuterExpression(parent, ast.OEKParentheses|ast.OEKAssertions) ||
			(ast.IsConditionalExpression(parent) && parent.AsConditionalExpression().Condition != node) ||
			(isPipeExpression(parent) && parent.AsBinaryExpression().Right == node) {
			node = parent
			continue
		}
		break
	}
	decl := node.Parent
	if decl == nil || !ast.IsVariableDeclaration(decl) || decl.Initializer() != node || decl.Type() == nil {
		return nil
	}
	if list := decl.Parent; list == nil || list.Kind != ast.KindVariableDeclarationList || list.Flags&ast.NodeFlagsConst == 0 {
		return nil
	}
	return decl
}
