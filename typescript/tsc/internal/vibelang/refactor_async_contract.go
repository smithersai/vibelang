package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The selected function changes from Promise to Effect. Its written containing
// contract, inherited member and overload declarations are outside this edit.
func asyncKeepsPromiseContract(c *checker.Checker, fn *ast.Node) bool {
	promiseCallable := func(t *checker.Type) bool {
		if t == nil {
			return false
		}
		for _, sig := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
			for _, part := range unionMembers(c.GetReturnTypeOfSignature(sig)) {
				if part.Flags()&checker.TypeFlagsAnyOrUnknown == 0 && c.GetPromisedTypeOfPromise(part) != nil {
					return true
				}
			}
		}
		return false
	}
	if ast.IsFunctionExpressionOrArrowFunction(fn) && promiseCallable(c.GetContextualType(fn, checker.ContextFlagsNone)) {
		return true
	}
	if ast.IsFunctionDeclaration(fn) || ast.IsMethodDeclaration(fn) {
		if symbol := c.GetSymbolOfDeclaration(fn); symbol != nil && len(symbol.Declarations()) > 1 {
			return true
		}
	}
	if !ast.IsMethodDeclaration(fn) {
		return false
	}
	symbol := c.GetSymbolOfDeclaration(fn)
	if symbol == nil {
		return false
	}
	name := symbol.Name()
	memberRequiresPromise := func(t *checker.Type) bool {
		return t != nil && promiseCallable(c.GetTypeOfPropertyOfType(t, name))
	}
	owner := fn.Parent
	if ast.IsObjectLiteralExpression(owner) {
		return memberRequiresPromise(c.GetContextualType(owner, checker.ContextFlagsNone))
	}
	if !ast.IsClassLike(owner) {
		return false
	}
	for _, kind := range []ast.Kind{ast.KindExtendsKeyword, ast.KindImplementsKeyword} {
		if kind == ast.KindImplementsKeyword && ast.IsStatic(fn) {
			continue
		}
		for _, element := range ast.GetHeritageElements(owner, kind) {
			t := c.GetTypeFromTypeNode(element)
			if kind == ast.KindExtendsKeyword && ast.IsStatic(fn) {
				t = c.GetTypeAtLocation(element.Expression())
			}
			if memberRequiresPromise(t) {
				return true
			}
		}
	}
	return false
}
