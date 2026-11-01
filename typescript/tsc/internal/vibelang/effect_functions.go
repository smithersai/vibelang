package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A function marked effect is an Effect function (VIP-1), and an effect
// block is the Effect its block builds (VIP-2). The parser flags each
// (parser/vibelang_effect.go): the function itself, and for effect { … } an
// arrow with no parameters whose => stands on effect.

// isMarkedEffect reports whether fn is marked effect or is an effect block.
func isMarkedEffect(fn *ast.Node) bool {
	return fn != nil && fn.Flags&ast.NodeFlagsVibeLangEffect != 0
}

// isEffectBlock reports whether node is the arrow the parser writes for an
// effect block, effect { … }.
func isEffectBlock(node *ast.Node) bool {
	return isMarkedEffect(node) && isProgramArrow(node)
}

// markedForm is the form a function compiles to: a program for an effect
// block, an Effect function for any other function marked effect, and
// formNone, plain JavaScript, for a function without the mark. An arrow the
// parser writes and calls where it stands, as for a match or an is
// expression, is no function in the source: it has the form of the code
// around it, an Effect function in effect code.
//
// A catch expression in effect code runs its left side and gives a plain
// handler's result as its value (VIP-5: x catch (e) => f(e) is
// Effect.catch(x, (e) => Effect.succeed(f(e)))). The parser passes both
// sides to $catchExpression as functions. The left side's function is the
// code around it: plain, giving the Effect to run, or, when a try in it runs
// an Effect first, an Effect function that runs what it gives
// (catchLeftRuns). A plain handler is typed and lowered as an Effect function
// whose body runs nothing, so its result is the success value.
func markedForm(fn *ast.Node) form {
	switch {
	case isEffectBlock(fn):
		return formProgram
	case isMarkedEffect(fn):
		return formEffect
	case isCalledInPlace(fn) && inEffectCode(fn):
		return formEffect
	case isCatchLeftFunction(fn) && inEffectCode(fn) && holdsTry(fn.Body()):
		return formEffect
	case isCatchHandlerOf(fn) && inEffectCode(fn):
		return formEffect
	case isProgramArrow(fn) && isBlockParamCall(fn.Parent) && fn.Parent.Arguments()[len(fn.Parent.Arguments())-1] == fn:
		return formProgram // f(args) { block } passes the block as a program, as f(args, effect { block }) does (blockparams.go)
	case isProgramArrow(fn) && !isCatchLeftFunction(fn) && inEffectCode(fn):
		// Any other function the parser writes, a fork block, a block
		// parameter or a for concurrent body, holds code of the effect code
		// around it: without parameters it is the program the form passes
		// (blockparams.go), else an Effect function.
		if len(fn.Parameters()) == 0 {
			return formProgram
		}
		return formEffect
	}
	return formNone
}

// isCatchLeft reports whether fn is the function the parser writes around a
// catch expression's left side.
func isCatchLeftFunction(fn *ast.Node) bool {
	call := catchExpressionOf(fn.Parent)
	return call != nil && call.Arguments()[0] == fn
}

// isCatchHandlerOf reports whether fn is a catch expression's handler, the
// function literal the source writes after catch.
func isCatchHandlerOf(fn *ast.Node) bool {
	call := catchExpressionOf(fn.Parent)
	return call != nil && call.Arguments()[1] == fn
}

// holdsTry reports whether node holds a try outside the functions nested in
// it.
func holdsTry(node *ast.Node) bool {
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if found || isFunctionBoundary(n) && !isCalledInPlace(n) && !isCatchLeftFunction(n) {
			return found
		}
		if isTry(n) {
			found = true
			return true
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return found
}

// isCatchLeftBody reports whether node, through parentheses, is the whole
// left side of a catch expression: the body of the function the parser
// writes around it.
func isCatchLeftBody(node *ast.Node) bool {
	fn := node.Parent
	for fn != nil && ast.IsParenthesizedExpression(fn) {
		fn = fn.Parent
	}
	return fn != nil && isCatchLeftFunction(fn) && fn.Body() != nil && ast.SkipParentheses(fn.Body()) == node
}

// catchLeftRuns reports whether call is the left side of a catch expression
// whose function is an Effect function (markedForm): that function runs the
// Effect the left side gives, as the catch runs it.
func catchLeftRuns(call *ast.Node) bool {
	fn := call.Parent
	for fn != nil && ast.IsParenthesizedExpression(fn) {
		fn = fn.Parent
	}
	return fn != nil && isCatchLeftFunction(fn) && fn.Body() != nil && ast.SkipParentheses(fn.Body()) == call && markedForm(fn) == formEffect
}
