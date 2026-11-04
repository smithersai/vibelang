package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// VIP-1 binds parameters once at the call; only the body belongs to gen.
// All executions of the resulting Effect share that call's parameter cells.
func (tx *lowering) callTimeEffectBody(node *ast.Node, parameters *ast.NodeList, body *ast.Node) (*ast.NodeList, *ast.Node) {
	f := tx.Factory()
	// Preserve the source frame while keeping parameters in the outer callable.
	// A named expression's recursive references must keep the outer binding.
	generator := tx.generatorExpression(node, sourceName(node), f.NewNodeList(nil), body)
	if refersToOwnName(node) {
		generator = tx.nameFreeGenerator(node, sourceName(node), f.NewNodeList(nil), body)
	}
	tx.EmitContext().SetOriginal(generator, node)
	tx.generatedFunctions(generator)
	arguments := []*ast.Node{generator}
	if usesThis(node.Body()) {
		self := f.NewPropertyAssignment(nil, f.NewIdentifier("self"), nil, nil, f.NewThisExpression())
		arguments = []*ast.Node{f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{self}), false), generator}
	}
	effect := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("gen"), ast.NodeFlagsNone), nil, nil, f.NewNodeList(arguments), ast.NodeFlagsNone)
	if bindingMayThrow(node) {
		return tx.effectBindingBoundary(node, parameters, effect)
	}
	var statements []*ast.Node
	for _, statement := range bodyStatements(node.Body()) {
		if !ast.IsPrologueDirective(statement) {
			break
		}
		statements = append(statements, f.NewExpressionStatement(f.NewStringLiteralFromNode(statement.Expression())))
	}
	statements = append(statements, tx.generated(f.NewReturnStatement(effect)))
	return parameters, f.NewBlock(f.NewNodeList(statements), true)
}

// Keep the source callable's kind and name; it owns its arguments and frame.
func (tx *lowering) directFunctionBody(node *ast.Node, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	f := tx.Factory()
	var lowered *ast.Node
	if node.Kind == ast.KindArrowFunction {
		lowered = f.NewArrowFunction(nil, nil, parameters, nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), body)
	} else {
		lowered = f.NewFunctionExpression(nil, nil, node.Name(), nil, parameters, nil, nil, body)
	}
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}

// A failing default or destructuring operation becomes a defect in the
// returned Effect, without throwing from the call (VIP-1, chapter 3).
// The inner arrow binds once and keeps the source this, arguments and super.
func (tx *lowering) effectBindingBoundary(node *ast.Node, parameters *ast.NodeList, effect *ast.Node) (*ast.NodeList, *ast.Node) {
	f := tx.Factory()
	var bound, placeholders []*ast.Node
	for _, parameter := range parameters.Nodes {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		bound = append(bound, parameter)
	}
	for _, parameter := range node.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		p := parameter.AsParameterDeclaration()
		if p.Initializer != nil || p.DotDotDotToken != nil {
			break
		}
		placeholders = append(placeholders, f.NewParameterDeclaration(nil, nil, f.NewUniqueName("arg"), nil, nil, nil))
	}
	var args *ast.Node = f.NewIdentifier("arguments")
	if node.Kind == ast.KindArrowFunction {
		args = f.NewUniqueName("args")
		placeholders = append(placeholders, f.NewParameterDeclaration(nil, f.NewToken(ast.KindDotDotDotToken), args, nil, nil, nil))
		var items []*ast.Node
		for _, p := range placeholders[:len(placeholders)-1] {
			items = append(items, p.Name())
		}
		items = append(items, f.NewSpreadElement(args))
		args = f.NewArrayLiteralExpression(f.NewNodeList(items), false)
	}
	bind := f.NewArrowFunction(nil, nil, f.NewNodeList(bound), nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), effect)
	call := f.NewCallExpression(f.NewParenthesizedExpression(bind), nil, nil, f.NewNodeList([]*ast.Node{f.NewSpreadElement(args)}), ast.NodeFlagsNone)
	thrown := f.NewUniqueName("e")
	die := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("die"), ast.NodeFlagsNone), nil, nil, f.NewNodeList([]*ast.Node{thrown}), ast.NodeFlagsNone)
	caught := f.NewCatchClause(f.NewVariableDeclaration(thrown, nil, nil, nil), f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(die))}), true))
	attempt := f.NewTryStatement(f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(call)}), true), caught, nil)
	return f.NewNodeList(placeholders), f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(attempt)}), true)
}
