package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-1 binds parameters once at the call; only the body belongs to gen.
// All executions of the resulting Effect share that call's parameter cells.
// Parameter defaults the parser moved into the body (VIP-2, a default whose
// do expression returns: parser/vibelang_do_parameters.go) stay at the
// call too: the body is then `{ temps…; { shadows…; { source body } } }`,
// the generator takes the source body, the temps and shadows run inside
// the binding boundary before Effect.gen, and a return among them returns
// Effect.succeed of its value, so the call gives that Effect without
// starting the body.
func (tx *lowering) callTimeEffectBody(node *ast.Node, parameters *ast.NodeList, body *ast.Node) (*ast.NodeList, *ast.Node) {
	f := tx.Factory()
	var outer, middle *ast.Node
	if parser.VibeLangHasMovedDefaults(node) {
		outer = body
		statements := outer.AsBlock().Statements.Nodes
		middle = statements[len(statements)-1]
		inner := middle.AsBlock().Statements.Nodes
		body = inner[len(inner)-1]
	}
	// Preserve the source frame while keeping parameters in the outer callable.
	// A named expression's recursive references must keep the outer binding.
	generator := tx.generatorExpression(node, sourceName(node), f.NewNodeList(nil), body)
	if refersToOwnName(node) {
		generator = tx.nameFreeGenerator(node, sourceName(node), f.NewNodeList(nil), body)
	}
	tx.EmitContext().SetOriginal(generator, node)
	tx.generatedFunctions(generator)
	if node.Kind == ast.KindArrowFunction {
		tx.lexicalReceiver(generator)
	}
	arguments := []*ast.Node{generator}
	if node.Kind != ast.KindArrowFunction && usesThis(node.Body()) {
		self := f.NewPropertyAssignment(nil, f.NewIdentifier("self"), nil, nil, f.NewThisExpression())
		arguments = []*ast.Node{f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{self}), false), generator}
	}
	effect := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("gen"), ast.NodeFlagsNone), nil, nil, f.NewNodeList(arguments), ast.NodeFlagsNone)
	if outer != nil {
		return tx.effectBindingBoundary(node, parameters, tx.movedDefaultsBody(outer, middle, effect))
	}
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

// movedDefaultsBody returns outer, the body `{ temps…; { shadows…; { source
// body } } }` of a function whose parameter defaults moved, with the source
// body replaced by `return effect` and each return among the temps and
// shadows returning Effect.succeed of its value.
func (tx *lowering) movedDefaultsBody(outer, middle, effect *ast.Node) *ast.Node {
	f := tx.Factory()
	var prologue func(statements []*ast.Node) []*ast.Node
	prologue = func(statements []*ast.Node) []*ast.Node {
		out := make([]*ast.Node, 0, len(statements))
		for _, statement := range statements {
			out = append(out, tx.succeedReturns(statement))
		}
		return out
	}
	outerStatements := outer.AsBlock().Statements.Nodes
	middleStatements := middle.AsBlock().Statements.Nodes
	returned := tx.generated(f.NewReturnStatement(effect))
	newMiddle := f.NewBlock(f.NewNodeList(append(prologue(middleStatements[:len(middleStatements)-1]), returned)), true)
	tx.EmitContext().SetOriginal(newMiddle, middle)
	newOuter := f.NewBlock(f.NewNodeList(append(prologue(outerStatements[:len(outerStatements)-1]), newMiddle)), true)
	tx.EmitContext().SetOriginal(newOuter, outer)
	return newOuter
}

// succeedReturns returns statement with each return outside a nested
// function returning Effect.succeed of its value (undefined for a bare
// return): VIP-2, an effect function's call gives an Effect that succeeds
// with a parameter default's returned value.
func (tx *lowering) succeedReturns(statement *ast.Node) *ast.Node {
	f := tx.Factory()
	var visitor *ast.NodeVisitor
	visitor = tx.EmitContext().NewNodeVisitor(func(node *ast.Node) *ast.Node {
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			return node
		}
		if node.Kind == ast.KindReturnStatement {
			value := node.Expression()
			if value == nil {
				value = f.NewVoidExpression(f.NewNumericLiteral("0", ast.TokenFlagsNone))
			}
			succeed := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("succeed"), ast.NodeFlagsNone), nil, nil, f.NewNodeList([]*ast.Node{value}), ast.NodeFlagsNone)
			returned := f.NewReturnStatement(succeed)
			tx.EmitContext().SetOriginal(returned, node)
			returned.Loc = node.Loc
			return returned
		}
		return visitor.VisitEachChild(node)
	})
	return visitor.VisitNode(statement)
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
	// Forward generated argument storage without consulting mutable iterator
	// hooks. Parameter binding itself performs no argument-list iteration.
	// A source destructuring pattern still iterates its own input normally.
	spread := func(items *ast.Node) *ast.Node {
		return f.NewSpreadElement(tx.generated(tx.runtimeCall("$spreadItems", items)))
	}
	args := []*ast.Node{spread(f.NewIdentifier("arguments"))}
	if node.Kind == ast.KindArrowFunction {
		rest := f.NewUniqueName("args")
		args = nil
		for _, p := range placeholders {
			args = append(args, p.Name())
		}
		placeholders = append(placeholders, f.NewParameterDeclaration(nil, f.NewToken(ast.KindDotDotDotToken), rest, nil, nil, nil))
		args = append(args, spread(rest))
	}
	bind := f.NewArrowFunction(nil, nil, f.NewNodeList(bound), nil, nil, f.NewToken(ast.KindEqualsGreaterThanToken), effect)
	call := f.NewCallExpression(f.NewParenthesizedExpression(bind), nil, nil, f.NewNodeList(args), ast.NodeFlagsNone)
	thrown := f.NewUniqueName("e")
	die := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("die"), ast.NodeFlagsNone), nil, nil, f.NewNodeList([]*ast.Node{thrown}), ast.NodeFlagsNone)
	caught := f.NewCatchClause(f.NewVariableDeclaration(thrown, nil, nil, nil), f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(die))}), true))
	attempt := f.NewTryStatement(f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(call)}), true), caught, nil)
	return f.NewNodeList(placeholders), f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(attempt)}), true)
}
