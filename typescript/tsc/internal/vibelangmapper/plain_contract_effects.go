package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// checkPlainContractEffects enforces D282: a plain contract never fails and
// needs nothing, so it cannot run a named Effect operation, and a throw that
// can escape it is a typed failure it cannot have. A throw a try of the same
// function catches stays inside it; a throw, do, or match expression is part
// of the function that holds it. Nested functions and by-name arguments own
// their Effect bodies (D147); constructing either runs nothing in the
// enclosing function.
func (p *projector) checkPlainContractEffects(fn *ast.Node) {
	if fn.Body() == nil {
		return
	}
	caught := map[*ast.Node]bool{} // try blocks whose catch clause handles their throws
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if invokedForm(node) {
			return node.Body().ForEachChild(visit)
		}
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			return false
		}
		if node.Kind == ast.KindTryStatement && node.AsTryStatement().CatchClause != nil {
			caught[node.AsTryStatement().TryBlock] = true
		}
		if node.Kind == ast.KindThrowStatement && !p.throwCaught(node, fn, caught) {
			start := p.tokenStart(node)
			p.diagnostics = append(p.diagnostics, Diagnostic{
				Start: start, Length: node.End() - start, Code: CodePlainContractEffect,
				Message: "A plain function can't throw: its return annotation makes it a plain function, which never fails. Make it an Effect function, A!E!; or fail with a defect instead, die(error), annotated A!!; or escape to TypeScript in a .ts file or a module block.",
			})
			return true
		}
		// A property assignment can inherit a program class too, but is
		// not itself the deferred expression (D265).
		if ast.IsExpression(node) && p.forms.Argument(node).ByName {
			// D147 defers the entire argument expression. D265 and D269 hold only
			// the field's or const's outer call, so its operands must still be checked.
			if r, ok := p.forms.(*Resolver); !ok || !r.holdsProgram(node) {
				return false
			}
		}
		if node.Kind == ast.KindCallExpression && p.plainContractEffectCall(node) {
			start := p.tokenStart(node)
			p.diagnostics = append(p.diagnostics, Diagnostic{
				Start: start, Length: node.End() - start, Code: CodePlainContractEffect,
				Message: "A function with a plain return contract cannot run an Effect. Write an Effect return contract instead.",
			})
			return true
		}
		return node.ForEachChild(visit)
	}
	visit(fn.Body())
}

// plainContractEffectCall reuses purity's named-call classification (D54),
// excluding shipped JavaScript failures and known synchronous module functions.
// An unknown foreign call supplies no evidence that a plain contract runs Effects.
func (p *projector) plainContractEffectCall(call *ast.Node) bool {
	// D265 holds this call as a program. The diagnostic walk still visits
	// its operands, whose calls retain their ordinary evaluation rules.
	if r, ok := p.forms.(*Resolver); ok && r.holdsProgram(call) {
		return false
	}
	if p.builtinFailure(call) != "" || p.callObstacle(call, func(string) (obstacle, bool) { return obstacleUnknown, false }) != obstacleBlocking {
		return false
	}
	if r, ok := p.forms.(*Resolver); ok {
		if r.Callee(call).Kind == CalleeTable {
			return r.returnsEffect(call)
		}
		receiver := call.Expression()
		if ast.IsPropertyAccessExpression(receiver) {
			receiver = receiver.Expression()
		}
		if ast.IsIdentifier(receiver) && p.mayBeServiceKey(receiver) {
			// A capitalization-based adaptation hint is not evidence that a
			// plain contract reads a service. Resolve the actual lexical
			// declaration; parameters and ordinary values can shadow a key.
			declaration := r.binding(receiver, receiver.Text())
			return p.pinnedContextKey(receiver) ||
				declaration != nil && (isServiceClass(declaration) || isServiceShapeClass(declaration))
		}
	}
	return true
}

// invokedForm reports whether node is the arrow the parser writes for a throw,
// do, or match expression and calls where it stands: (() => { … })().
func invokedForm(node *ast.Node) bool {
	if node.Kind != ast.KindArrowFunction || len(node.Parameters()) != 0 || node.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	callee := node.Parent
	if callee == nil || callee.Kind != ast.KindParenthesizedExpression {
		return false
	}
	call := callee.Parent
	return call != nil && ast.IsCallExpression(call) && call.Expression() == callee && len(call.Arguments()) == 0
}

// throwCaught reports whether a try block of fn, one of caught, encloses
// throw, walking out through throw, do, and match expressions.
func (p *projector) throwCaught(throw *ast.Node, fn *ast.Node, caught map[*ast.Node]bool) bool {
	for n := throw.Parent; n != nil && n != fn; n = n.Parent {
		if caught[n] {
			return true
		}
		if (ast.IsFunctionLike(n) || ast.IsClassLike(n)) && !invokedForm(n) {
			return false
		}
	}
	return false
}

// checkPlainGeneratorThrows reports a throw that can escape fn, a generator
// with a JavaScript iterator annotation (D271): it follows D282 like any
// plain function (D296), and its calls run nothing, so only throws matter.
func (p *projector) checkPlainGeneratorThrows(fn *ast.Node) {
	if fn.Body() == nil {
		return
	}
	caught := map[*ast.Node]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if invokedForm(node) {
			return node.Body().ForEachChild(visit)
		}
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			return false
		}
		if node.Kind == ast.KindTryStatement && node.AsTryStatement().CatchClause != nil {
			caught[node.AsTryStatement().TryBlock] = true
		}
		if node.Kind == ast.KindThrowStatement && !p.throwCaught(node, fn, caught) {
			start := p.tokenStart(node)
			p.diagnostics = append(p.diagnostics, Diagnostic{
				Start: start, Length: node.End() - start, Code: CodePlainContractEffect,
				Message: "A JavaScript generator can't throw: its iterator annotation makes it one, which never fails. Remove the annotation to make it a producer, a Stream whose throw fails the Stream, or escape to TypeScript in a module block or a .ts file.",
			})
			return true
		}
		return node.ForEachChild(visit)
	}
	visit(fn.Body())
}
