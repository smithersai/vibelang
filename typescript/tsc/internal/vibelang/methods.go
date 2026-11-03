package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// expectsEffect reports whether fn, a method, is expected to return an
// Effect, so it compiles to an Effect even when its body runs nothing: the
// type its object literal's contextual type gives it, or the member it
// implements through its class's implements clause, is a function that
// returns an Effect. A provider's { find: (id) => ({ … }) } and a class that
// implements a service with plain-looking methods both need this.
func (a *analyzer) expectsEffect(fn *ast.Node) bool {
	if fn.Kind != ast.KindMethodDeclaration || ast.IsStatic(fn) {
		return false
	}
	var expected []*checker.Type
	switch parent := fn.Parent; {
	case ast.IsObjectLiteralExpression(parent):
		if t := a.checker.GetContextualTypeForObjectLiteralElement(fn, checker.ContextFlagsSignature); t != nil {
			expected = append(expected, a.declaredMemberType(t))
		}
	case ast.IsClassLike(parent):
		name := fn.Name()
		if !ast.IsIdentifier(name) && !ast.IsStringLiteral(name) {
			return false
		}
		for _, heritage := range ast.GetImplementsHeritageClauseElements(parent) {
			if member := a.checker.GetPropertyOfType(implementedType(a.checker, parent, heritage), name.Text()); member != nil {
				expected = append(expected, a.declaredMemberType(a.checker.GetTypeOfSymbol(member)))
			}
		}
	}
	return a.classify(expected).effectFn
}

// lowerMethod turns a method whose body runs Effects into a method that
// returns an Effect. The method keeps its name and parameters, so object
// literal methods and class methods stay methods, and its body runs as a
// generator with the method's this:
//
//	find(id) { return Effect.gen({ self: this }, function* () { … }) }
//
// A body that does not mention this omits the { self: this } argument.
func (tx *lowering) lowerMethod(node *ast.Node) *ast.Node {
	f := tx.Factory()
	ec := tx.EmitContext()
	method := node.AsMethodDeclaration()

	saved, savedFrame, savedPlain := tx.inEffect, tx.frame, tx.plain
	tx.inEffect, tx.plain = false, false // a parameter list cannot yield
	parameters := ec.VisitParameters(node.ParameterList(), tx.Visitor())
	tx.inEffect = true
	tx.frame = &frame{name: functionName(node), clause: tx.plan.resumesInTail(node)}
	body := ec.VisitFunctionBody(node.Body(), tx.Visitor())
	tx.inEffect, tx.frame, tx.plain = saved, savedFrame, savedPlain

	if !hasSimpleParameters(node) || tx.plan.parameterWrites[node] {
		if isMarkedEffect(node) {
			parameters, block := tx.callTimeEffectBody(node, parameters, body)
			lowered := f.UpdateMethodDeclaration(method, node.Modifiers(), method.AsteriskToken, node.Name(), method.PostfixToken, method.TypeParameters, parameters, method.Type, method.FullSignature, block)
			ec.SetOriginal(lowered, node)
			return lowered
		}
		return tx.perRunMethod(node, parameters, body)
	}
	if effect := tx.directEffect(node, body, thunkIsReturn); effect != nil {
		block := f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(effect))}), true /*multiLine*/)
		lowered := f.UpdateMethodDeclaration(method, node.Modifiers(), method.AsteriskToken, node.Name(), method.PostfixToken, method.TypeParameters, parameters, method.Type, method.FullSignature, block)
		ec.SetOriginal(lowered, node)
		return lowered
	}
	if isMarkedEffect(node) && len(node.Parameters()) > 0 {
		parameters, block := tx.callTimeEffectBody(node, parameters, body)
		lowered := f.UpdateMethodDeclaration(method, node.Modifiers(), method.AsteriskToken, node.Name(), method.PostfixToken, method.TypeParameters, parameters, method.Type, method.FullSignature, block)
		ec.SetOriginal(lowered, node)
		return lowered
	}
	generator := tx.generatorExpression(node, sourceName(node), f.NewNodeList(nil), body)
	ec.SetOriginal(generator, node)
	tx.generatedFunctions(generator) // the method stands for the source method
	arguments := []*ast.Node{generator}
	if usesThis(node.Body()) {
		self := f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("self"), nil /*postfixToken*/, nil /*type*/, f.NewKeywordExpression(ast.KindThisKeyword))
		arguments = []*ast.Node{f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{self}), false /*multiLine*/), generator}
	}
	gen := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("gen"), ast.NodeFlagsNone), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
	block := f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(gen))}), true /*multiLine*/)
	lowered := f.UpdateMethodDeclaration(method, node.Modifiers(), method.AsteriskToken, node.Name(), method.PostfixToken, method.TypeParameters, parameters, method.Type, method.FullSignature, block)
	ec.SetOriginal(lowered, node)
	return lowered
}

// perRunMethod binds source parameters inside fnUntraced on every execution,
// as for an Effect function declaration. The forwarding method keeps its
// receiver, all arguments, and its arity without allocating a rest array or
// evaluating a default or destructuring pattern when called.
func (tx *lowering) perRunMethod(node *ast.Node, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	f := tx.Factory()
	method := node.AsMethodDeclaration()
	// fnUntraced calls the generator with the method's this and arguments on
	// every run, so it runs as the source method (frames_lower.go).
	generator := tx.generatedFunctions(tx.forwarding(tx.generatorFrom(node, parameters, body)))
	lowered := tx.wrapGenerator("fnUntraced", node, generator)
	apply := f.NewPropertyAccessExpression(lowered, nil, f.NewIdentifier("apply"), ast.NodeFlagsNone)
	call := f.NewCallExpression(apply, nil, nil, f.NewNodeList([]*ast.Node{f.NewThisExpression(), f.NewIdentifier("arguments")}), ast.NodeFlagsNone)
	var forwarding []*ast.Node
	for _, parameter := range node.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		p := parameter.AsParameterDeclaration()
		if p.Initializer != nil || p.DotDotDotToken != nil {
			break
		}
		forwarding = append(forwarding, f.NewParameterDeclaration(nil, nil, f.NewUniqueName("arg"), nil, nil, nil))
	}
	var statements []*ast.Node
	for _, statement := range node.Body().Statements() {
		if !ast.IsPrologueDirective(statement) {
			break
		}
		statements = append(statements, f.NewExpressionStatement(f.NewStringLiteralFromNode(statement.Expression())))
	}
	statements = append(statements, tx.generated(f.NewReturnStatement(call)))
	block := f.NewBlock(f.NewNodeList(statements), true /*multiLine*/)
	result := f.UpdateMethodDeclaration(method, node.Modifiers(), method.AsteriskToken, node.Name(), method.PostfixToken, method.TypeParameters, f.NewNodeList(forwarding), method.Type, method.FullSignature, block)
	tx.EmitContext().SetOriginal(result, node)
	return result
}

// usesThis reports whether body refers to this, looking into arrow
// functions, which share their enclosing function's this, and into what a
// class evaluates where it is defined, such as its extends clause and
// computed member names, but not into other functions, class fields or
// static blocks (bindsFrame). super counts: a super call that the lowering
// moves into a generator passes this as its receiver (frames_lower.go).
func usesThis(body *ast.Node) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindThisKeyword || node.Kind == ast.KindSuperKeyword {
			return true
		}
		return node.ForEachChild(func(child *ast.Node) bool { return !bindsFrame(node, child) && visit(child) })
	}
	return body != nil && visit(body)
}
