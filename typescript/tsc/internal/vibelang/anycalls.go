package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { fileChecks = append(fileChecks, checkAnyCallResults) }

// checkAnyCallResults reports EK4409 where an Effect function or a program
// returns the result of calling a value of type any. D24 runs a call's result
// only when the call's type is Effect itself, so the call's value is the
// function's success value, and a program the callee returns never runs:
// `Effect.updateContext(() => execute(), f)` with `execute: any` succeeded
// with the Effect execute returned. Nothing in the program says which the
// callee returns, so the warning names the call.
func checkAnyCallResults(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isLowerable(node) && !isProducer(node) {
			if a.isEffect(node) {
				factoryReturns(node, func(value *ast.Node) { checkAnyCallResult(c, node, value) })
			} else if a.hasContract(node) && requiresPrimitiveSuccess(c, node) {
				// D10 can compile a named contracted function to plain code.
				// Warn only when the erased local initializer proves that the
				// returned call produces a program; ordinary any calls stay quiet.
				factoryReturns(node, func(value *ast.Node) {
					if knownErasedProgramCall(c, a, value) {
						checkAnyCallResult(c, node, value)
					}
				})
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkAnyCallResult reports EK4409 when value, what fn returns, is a call
// of a value of type any.
func checkAnyCallResult(c *checker.Checker, fn *ast.Node, value *ast.Node) {
	if value == nil {
		return
	}
	value = ast.SkipParentheses(value)
	if !ast.IsCallExpression(value) || triedFlag(value) {
		return // VIP-5 explicitly delegates this call; its result is run.
	}
	callee := value.Expression()
	if missingCallPipe(c, callee) != nil {
		return // EK4502 explains the missing member, rather than an untyped call.
	}
	if t := c.GetTypeAtLocation(callee); t == nil || t == c.GetErrorType() || t.Flags()&checker.TypeFlagsAny == 0 {
		return
	}
	d := report(c, value, EK4409, messageText(value, "This call"), functionDisplayName(fn))
	named := callee
	for ast.IsParenthesizedExpression(named) || ast.IsAsExpression(named) || ast.IsTypeAssertion(named) || ast.IsSatisfiesExpression(named) {
		named = named.Expression() // (loader as any)() names loader
	}
	note(d, "Give {0} a type: a function type that returns A!E!R runs the program the call returns, and one that returns a value type keeps the value.", messageText(named, "the callee"))
}

// knownErasedProgramCall follows a local const, never a mutable binding or an
// arbitrary any-valued API. Its initializer retains the Effect behavior that
// the binding's any annotation erased.
func knownErasedProgramCall(c *checker.Checker, a *analyzer, value *ast.Node) bool {
	if value == nil {
		return false
	}
	value = ast.SkipParentheses(value)
	if !ast.IsCallExpression(value) {
		return false
	}
	callee := value.Expression()
	for ast.IsParenthesizedExpression(callee) || ast.IsAsExpression(callee) || ast.IsTypeAssertion(callee) || ast.IsSatisfiesExpression(callee) {
		callee = callee.Expression()
	}
	if !ast.IsIdentifier(callee) {
		return false
	}
	symbol := c.GetSymbolAtLocation(callee)
	if symbol == nil {
		return false
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || !ast.IsVariableDeclaration(declaration) || declaration.Parent == nil ||
		declaration.Parent.Flags&ast.NodeFlagsConst == 0 || declaration.Initializer() == nil {
		return false
	}
	initializer := ast.SkipParentheses(declaration.Initializer())
	if isLowerable(initializer) && (hasEscapingThrow(initializer) || a.isEffect(initializer) || a.hasContract(initializer)) {
		return true
	}
	for _, signature := range c.GetSignaturesOfType(c.GetTypeAtLocation(initializer), checker.SignatureKindCall) {
		if isEffectType(c, c.GetReturnTypeOfSignature(signature)) {
			return true
		}
	}
	return false
}

// A permissive success type can intentionally keep a cold program as a value.
// Limit the new pure-body check to contracts that definitely require a
// primitive, so ordinary any use with unknown, object, or Effect success
// values does not gain a warning.
func requiresPrimitiveSuccess(c *checker.Checker, fn *ast.Node) bool {
	success := successType(c, c.GetTypeFromTypeNode(fn.Type()))
	if success == nil {
		return false
	}
	const primitive = checker.TypeFlagsNumberLike | checker.TypeFlagsStringLike |
		checker.TypeFlagsBooleanLike | checker.TypeFlagsBigIntLike | checker.TypeFlagsESSymbolLike |
		checker.TypeFlagsNull | checker.TypeFlagsUndefined
	for _, part := range members(success) {
		if part.Flags()&primitive == 0 {
			return false
		}
	}
	return true
}
