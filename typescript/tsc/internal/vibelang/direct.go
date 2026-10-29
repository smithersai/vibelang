package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Direct Effects (S5-20). A generator costs every call of an Effect function
// two run-loop operations more than the TypeScript it replaces: fnUntraced
// suspends, starts an iterator, and succeeds with the value the generator
// returns. When the lowered body is a single return, and its only yield* is
// in a result position, the call returns that Effect itself, still evaluated
// only when it runs:
//
//	export const step = (n: number): Effect<number> => Effect.succeed(n + 1)
//	export const size = (items: string[]): Effect<number> => items.length
//	export const ignore = (event: string): Effect<void> => {}
//
// becomes
//
//	export const step = (n) => Effect.suspend({ step: () => { return Effect.succeed(n + 1); } }.step)
//	export const size = (items) => Effect.sync({ size: () => { return items.length; } }.size)
//	export const ignore = (event) => Effect.void
//
// An arrow's thunk has a block, so coverage counts the arrow's concise body,
// not the thunk's as well (thunkRole); a function declaration's or method's
// thunk is `() => value`, which stands for its return statement.
//
// Effect 4.1.0 dies with a throw from either thunk, as it does with one from
// a generator (internal/effect.ts:664-709), and suspend returns its program
// without a continuation (1015-1021). The thunk is an arrow, so this,
// arguments, and super are the function's own, and it is the property of an
// object literal named after the source, so a stack trace names the VibeLang
// function (D36). Every Effect the lowering yields is an Effect at run time
// (Context keys and Config are Effects in 4.1.0), so suspend accepts it.

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

// directEffect returns the Effect a call of node returns without a
// generator, given body, node's lowered body, or nil when body needs one.
// role says what its thunk stands for.
func (tx *lowering) directEffect(node *ast.Node, body *ast.Node, role thunkRole) *ast.Node {
	if _, traced := tx.plan.spans[node]; traced || ast.GetFunctionFlags(node)&ast.FunctionFlagsAsyncGenerator != 0 || tx.plan.resumesInTail(node) {
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
	value, program, ok := tx.directResult(statements[0].Expression())
	if !ok {
		return nil
	}
	method := "sync"
	if program {
		method = "suspend"
	}
	thunk := tx.namedThunk(sourceName(node), value, role)
	effect := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier(method), ast.NodeFlagsNone), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{thunk}), ast.NodeFlagsNone)
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

// directResult splits a lowered result into the expression its thunk
// returns and whether that is a program. A result position, through
// conditionals, commas, and parentheses, that is `yield* program` holds the
// program; a yield anywhere else needs the generator (ok is false). When some
// results are programs, the value results become Effect.succeed(value), as in
// byNameResult.
func (tx *lowering) directResult(node *ast.Node) (value *ast.Node, program bool, ok bool) {
	f := tx.Factory()
	inner := ast.SkipOuterExpressions(node, ast.OEKParentheses|ast.OEKTypeAssertions|ast.OEKNonNullAssertions|ast.OEKSatisfies)
	switch {
	case inner.Kind == ast.KindYieldExpression && inner.AsYieldExpression().AsteriskToken != nil:
		return inner.Expression(), true, !containsYield(inner.Expression())
	case inner.Kind == ast.KindConditionalExpression:
		conditional := inner.AsConditionalExpression()
		if containsYield(conditional.Condition) {
			return nil, false, false
		}
		left, leftProgram, leftOK := tx.directResult(conditional.WhenTrue)
		right, rightProgram, rightOK := tx.directResult(conditional.WhenFalse)
		if !leftOK || !rightOK {
			return nil, false, false
		}
		if leftProgram != rightProgram {
			if !leftProgram {
				left = tx.succeedByName(left)
			} else {
				right = tx.succeedByName(right)
			}
		}
		return f.UpdateConditionalExpression(conditional, conditional.Condition, conditional.QuestionToken, left, conditional.ColonToken, right), leftProgram || rightProgram, true
	case inner.Kind == ast.KindBinaryExpression && inner.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken:
		binary := inner.AsBinaryExpression()
		if containsYield(binary.Left) {
			return nil, false, false
		}
		right, rightProgram, rightOK := tx.directResult(binary.Right)
		if !rightOK {
			return nil, false, false
		}
		return f.UpdateBinaryExpression(binary, binary.Modifiers(), binary.Left, binary.Type, binary.OperatorToken, right), rightProgram, true
	}
	return node, false, !containsYield(node)
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
