package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Direct Effects keep the source callable and its lexical thunk.
// Pure returns use sync; delegated tails use gen, never suspend: even a
// typed Effect can expose observable iterator getters (VIP-5, detail 226).
// A private pair distinguishes delegated and ordinary conditional results.
// Array elements preserve value-only evaluation of anonymous functions and
// classes, without giving them an inferred property or variable name.
// thunkRole says what the thunk of a direct Effect stands for in the source,
// which decides how it maps (generated.go).
type thunkRole int

const (
	// thunkIsNode: the thunk replaces node, a lambda, so it keeps node's
	// source position.
	thunkIsNode thunkRole = iota
	// thunkIsReturn: node stays around the Effect, in a return statement that
	// maps to no source position, so the thunk maps to none and its body
	// stands for node's return statement.
	thunkIsReturn
	// thunkIsNothing: node stays around the Effect, an arrow whose concise
	// body, the Effect, stands for node's body, or the parser wrote node; the
	// thunk and its body stand for no source.
	thunkIsNothing
)

// directEffect returns the Effect for a single-result callable, given its
// lowered body, or nil when the general lowering is required.
// role says what its thunk stands for.
func (tx *lowering) directEffect(node *ast.Node, body *ast.Node, role thunkRole) *ast.Node {
	if ast.GetFunctionFlags(node)&ast.FunctionFlagsAsyncGenerator != 0 || tx.plan.resumesInTail(node) {
		return nil
	}
	f := tx.Factory()
	statements := body.Statements()
	if len(statements) == 0 || len(statements) == 1 && statements[0].Kind == ast.KindReturnStatement && statements[0].Expression() == nil {
		return f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("void"), ast.NodeFlagsNone)
	}
	if len(statements) != 1 || statements[0].Kind != ast.KindReturnStatement {
		return nil
	}
	value := statements[0].Expression()
	delegated := containsYield(value)
	if delegated {
		var ok bool
		value, ok = tx.tailCompletion(value)
		if !ok {
			return nil
		}
	}
	thunk := tx.namedThunk(sourceName(node), value, role)
	var effect *ast.Node
	if delegated {
		effect = tx.delegatedTail(node, thunk)
	} else {
		effect = f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("sync"), ast.NodeFlagsNone), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{thunk}), ast.NodeFlagsNone)
	}
	tx.EmitContext().SetOriginal(effect, statements[0])
	switch {
	case isProgramArrow(node):
		tx.generated(effect) // the arrow's concise body
	case role == thunkIsNothing:
		// The arrow's concise body stands for its source body.
		if loc := tx.EmitContext().SourceMapRange(value); !ast.PositionIsSynthesized(loc.Pos()) {
			tx.EmitContext().SetSourceMapRange(effect, loc)
		}
	}
	return effect
}

// tailCompletion keeps condition/comma evaluation in the source lexical
// thunk and records whether its result requires native yield* delegation.
func (tx *lowering) tailCompletion(node *ast.Node) (*ast.Node, bool) {
	f := tx.Factory()
	inner := ast.SkipOuterExpressions(node, ast.OEKParentheses|ast.OEKTypeAssertions|ast.OEKNonNullAssertions|ast.OEKSatisfies)
	pair := func(run bool, value *ast.Node) *ast.Node {
		flag := ast.KindFalseKeyword
		if run {
			flag = ast.KindTrueKeyword
		}
		return f.NewArrayLiteralExpression(f.NewNodeList([]*ast.Node{f.NewToken(flag), value}), false)
	}
	switch {
	case inner.Kind == ast.KindYieldExpression && inner.AsYieldExpression().AsteriskToken != nil:
		return pair(true, inner.Expression()), !containsYield(inner.Expression())
	case inner.Kind == ast.KindConditionalExpression:
		c := inner.AsConditionalExpression()
		if containsYield(c.Condition) {
			return nil, false
		}
		left, lok := tx.tailCompletion(c.WhenTrue)
		right, rok := tx.tailCompletion(c.WhenFalse)
		if !lok || !rok {
			return nil, false
		}
		return f.UpdateConditionalExpression(c, c.Condition, c.QuestionToken, left, c.ColonToken, right), true
	case inner.Kind == ast.KindBinaryExpression && inner.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken:
		b := inner.AsBinaryExpression()
		if containsYield(b.Left) {
			return nil, false
		}
		right, ok := tx.tailCompletion(b.Right)
		if !ok {
			return nil, false
		}
		return f.UpdateBinaryExpression(b, b.Modifiers(), b.Left, b.Type, b.OperatorToken, right), true
	}
	return pair(false, node), !containsYield(node)
}

// delegatedTail captures the thunk outside the generator's scope. Its source
// this, arguments, super, new.target and self references stay in the original
// callable. Only private compiler bindings are evaluated in the generator.
func (tx *lowering) delegatedTail(node, thunk *ast.Node) *ast.Node {
	f := tx.Factory()
	capture := f.NewUniqueName("_tail")
	result := f.NewUniqueName("_completion")
	valueName := f.NewUniqueName("_value")
	call := f.NewCallExpression(capture, nil, nil, f.NewNodeList(nil), ast.NodeFlagsNone)
	declare := f.NewVariableStatement(nil, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(result, nil, nil, call),
		f.NewVariableDeclaration(valueName, nil, nil, f.NewElementAccessExpression(result, nil, f.NewNumericLiteral("1", ast.TokenFlagsNone), ast.NodeFlagsNone)),
	}), ast.NodeFlagsConst))
	index := func(n string) *ast.Node {
		return f.NewElementAccessExpression(result, nil, f.NewNumericLiteral(n, ast.TokenFlagsNone), ast.NodeFlagsNone)
	}
	value := f.NewConditionalExpression(index("0"), f.NewToken(ast.KindQuestionToken),
		f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), valueName), f.NewToken(ast.KindColonToken), valueName)
	body := f.NewBlock(f.NewNodeList([]*ast.Node{declare, f.NewReturnStatement(value)}), true)
	generator := tx.generatorExpression(node, sourceName(node), nil, body)
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("gen"), ast.NodeFlagsNone)
	effect := f.NewCallExpression(callee, nil, nil, f.NewNodeList([]*ast.Node{generator}), ast.NodeFlagsNone)
	parameter := f.NewParameterDeclaration(nil, nil, capture, nil, nil, nil)
	factory := f.NewParenthesizedExpression(tx.generated(tx.arrow([]*ast.Node{parameter}, effect)))
	return f.NewCallExpression(factory, nil, nil, f.NewNodeList([]*ast.Node{thunk}), ast.NodeFlagsNone)
}

// namedThunk returns `() => value`, as `{ name: () => value }.name` when name
// is not "", which names the arrow without binding name inside it. role
// says what the thunk stands for (directEffect).
func (tx *lowering) namedThunk(name string, value *ast.Node, role thunkRole) *ast.Node {
	f := tx.Factory()
	var thunk *ast.Node
	switch role {
	case thunkIsNode:
		thunk = tx.arrow(nil, value)
	case thunkIsReturn:
		thunk = tx.generated(tx.arrow(nil, value))
	default:
		thunk = tx.generatedThunk(nil, value)
	}
	if name == "" || name == "__proto__" { // a __proto__ property sets the prototype
		return thunk
	}
	if !scanner.IsIdentifierText(name, core.LanguageVariantStandard) {
		object := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
			f.NewPropertyAssignment(nil /*modifiers*/, f.NewStringLiteral(name, ast.TokenFlagsNone), nil /*postfixToken*/, nil /*typeNode*/, thunk),
		}), false /*multiLine*/)
		return f.NewElementAccessExpression(object, nil /*questionDotToken*/, f.NewStringLiteral(name, ast.TokenFlagsNone), ast.NodeFlagsNone)
	}
	object := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier(name), nil /*postfixToken*/, nil /*typeNode*/, thunk),
	}), false /*multiLine*/)
	return f.NewPropertyAccessExpression(object, nil /*questionDotToken*/, f.NewIdentifier(name), ast.NodeFlagsNone)
}

// hasSimpleParameters reports whether every parameter of fn is a name
// without a default or rest token. Only then may a direct Effect function
// bind its parameters on the call: a default or a destructuring pattern runs code,
// which a generator runs when the Effect runs. A rest array must also be
// allocated anew on each execution.
func hasSimpleParameters(fn *ast.Node) bool {
	for _, parameter := range fn.Parameters() {
		if !ast.IsIdentifier(parameter.Name()) || parameter.Initializer() != nil || parameter.AsParameterDeclaration().DotDotDotToken != nil {
			return false
		}
	}
	return true
}
