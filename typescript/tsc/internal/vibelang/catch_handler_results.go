package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Chapter 2, Static rules (VIP-5): "a plain handler whose result type is a
// Promise or thenable (x catch (e) => queryDb(e)): the Promise is never run,
// as for an unwrapped Promise in effect code" is EK0507. The result test is
// chapter 2's: a type answers yes when it is not never, any or unknown and at
// least one union member is a thenable (decided detail 89, as
// typescript-eslint's no-floating-promises asks). An effect handler's result
// is what its Effect succeeds with, so the rule asks only of a plain one.

// plainCatchHandler returns the plain arrow or function expression a catch
// expression's handler is, or nil: the call's handler when the source wrote
// an arrow, or the literal a fallback holds (catch function () { }, or a
// parenthesized handler). An effect handler, an effect block, an async or
// generator function (EK0509) or a value (EK0509) is not one.
func plainCatchHandler(call, fallback *ast.Node) *ast.Node {
	handler := call.Arguments()[1]
	if fallback != nil {
		handler = ast.SkipParentheses(fallback)
	}
	if !ast.IsArrowFunction(handler) && !ast.IsFunctionExpression(handler) {
		return nil
	}
	if isMarkedEffect(handler) || isAsyncOrGenerator(handler) {
		return nil
	}
	return handler
}

// checkCatchHandlerResult applies the chapter 2 result tests: EK0508 warns
// about unrun Effects, while EK0507 rejects unhandled Promises/thenables.
func checkCatchHandlerResult(c *checker.Checker, file *ast.SourceFile, call, fallback *ast.Node) {
	handler := plainCatchHandler(call, fallback)
	if handler == nil {
		return
	}
	result := plainCatchHandlerResult(c, handler)
	if mayBeEffectResult(c, result) {
		d := reportAt(c, file, core.NewTextRange(scanner.SkipTrivia(file.Text(), handler.Pos()), handler.End()), EK0508)
		note(d, "Its result is {0}, which this catch returns as data. To run it, write catch effect (e) => try ….", typeTextAt(c, result, handler))
	}
	if !mayBeThenable(c, result) {
		return
	}
	d := reportAt(c, file, core.NewTextRange(scanner.SkipTrivia(file.Text(), handler.Pos()), handler.End()), EK0507)
	note(d, "Its result is {0}, which this catch gives unrun. Run it in an effect handler: catch effect (e) => try Effect.promise(() => …).", typeTextAt(c, result, handler))
}

// mayBeThenable is chapter 2's Promise result test: t is not never, any or
// unknown, and t or a member of its union has a callable then.
func mayBeThenable(c *checker.Checker, t *checker.Type) bool {
	if t == nil || t.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsNever) != 0 {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		return slices.ContainsFunc(t.Types(), func(member *checker.Type) bool { return mayBeThenable(c, member) })
	}
	then := c.GetPropertyOfType(t, "then")
	return then != nil && len(c.GetSignaturesOfType(c.GetTypeOfSymbol(then), checker.SignatureKindCall)) > 0
}

// Only a syntax-owned handler is lifted by the generated catch callback.
// A native function expression held in the fallback retains its own return
// type; unwrapping that type would inspect the returned Effect's success.
func plainCatchHandlerResult(c *checker.Checker, handler *ast.Node) *checker.Type {
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(handler), checker.SignatureKindCall)
	if len(signatures) == 0 {
		return nil
	}
	result := c.GetReturnTypeOfSignature(signatures[0])
	if markedForm(handler) == formEffect {
		if program := effectOfValue(c, result); program != nil {
			if success := channelType(c, program, "_A"); success != nil {
				return success
			}
		}
	}
	return result
}

// The result test asks whether any union member is an Effect, excluding the
// top and bottom types. It does not require every member to be an Effect.
func mayBeEffectResult(c *checker.Checker, t *checker.Type) bool {
	if t == nil || t.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsNever) != 0 {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		return slices.ContainsFunc(t.Types(), func(member *checker.Type) bool { return mayBeEffectResult(c, member) })
	}
	if t.Flags()&(checker.TypeFlagsInstantiableNonPrimitive|checker.TypeFlagsIntersection) != 0 {
		if base := c.GetBaseConstraintOfType(t); base != nil && base != t {
			return mayBeEffectResult(c, base)
		}
	}
	if !isEffectValueType(c, t) {
		return false
	}
	symbol := servicesFor(c).effectExport("Effect", "Effect")
	if symbol == nil {
		return false
	}
	any := c.GetAnyType()
	return c.IsTypeAssignableTo(t, c.NewTypeReference(c.GetDeclaredTypeOfSymbol(symbol), []*checker.Type{any, any, any}))
}
