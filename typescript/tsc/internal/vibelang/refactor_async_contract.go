package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/jsnum"
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
	member := fn
	if ast.IsFunctionExpressionOrArrowFunction(fn) {
		outer := fn
		for ast.IsParenthesizedExpression(outer.Parent) {
			outer = outer.Parent
		}
		if outer.Parent == nil || !ast.IsPropertyDeclaration(outer.Parent) || outer.Parent.AsPropertyDeclaration().Initializer != outer {
			return false
		}
		member = outer.Parent
	} else if !ast.IsMethodDeclaration(fn) {
		return false
	}
	symbol := c.GetSymbolOfDeclaration(member)
	if symbol == nil {
		return false
	}
	name := symbol.Name()
	var keyType *checker.Type
	indexRequiresPromise := func(t *checker.Type) bool {
		if t == nil {
			return false
		}
		for _, info := range c.GetIndexInfosOfType(t) {
			if !promiseCallable(info.ValueType()) {
				continue
			}
			if keyType == nil {
				if property := member.Name(); property != nil && ast.IsComputedPropertyName(property) {
					candidate := c.GetTypeAtLocation(property.Expression())
					if candidate.Flags()&checker.TypeFlagsESSymbolLike != 0 {
						keyType = candidate
					}
				}
				if keyType == nil {
					factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
					literal := factory.NewStringLiteral(name, ast.TokenFlagsNone)
					literalType := factory.NewLiteralTypeNode(literal)
					// Type resolution follows source ancestry for conditional constraints.
					literal.Parent = literalType
					literalType.Parent = member
					keyType = c.GetTypeFromTypeNode(literalType)
				}
			}
			if c.IsTypeAssignableTo(keyType, info.KeyType()) ||
				info.KeyType() == c.GetNumberType() && jsnum.FromString(name).String() == name {
				return true
			}
		}
		return false
	}
	memberRequiresPromise := func(t *checker.Type) bool {
		return t != nil && (promiseCallable(c.GetTypeOfPropertyOfType(t, name)) || indexRequiresPromise(t))
	}
	owner := member.Parent
	if ast.IsObjectLiteralExpression(owner) {
		return memberRequiresPromise(c.GetContextualType(owner, checker.ContextFlagsNone))
	}
	if !ast.IsClassLike(owner) {
		return false
	}
	// The class's own index signatures constrain inferred fields and methods;
	// its own named member is the selected function, not an external contract.
	if ownerSymbol := c.GetSymbolOfDeclaration(owner); ownerSymbol != nil {
		ownerType := c.GetDeclaredTypeOfSymbol(ownerSymbol)
		if ast.IsStatic(member) {
			ownerType = c.GetTypeOfSymbolAtLocation(ownerSymbol, owner)
		}
		if indexRequiresPromise(ownerType) {
			return true
		}
	}
	for _, kind := range []ast.Kind{ast.KindExtendsKeyword, ast.KindImplementsKeyword} {
		if kind == ast.KindImplementsKeyword && ast.IsStatic(member) {
			continue
		}
		for _, element := range ast.GetHeritageElements(owner, kind) {
			t := c.GetTypeFromTypeNode(element)
			if kind == ast.KindExtendsKeyword && ast.IsStatic(member) {
				t = c.GetTypeAtLocation(element.Expression())
			}
			if memberRequiresPromise(t) {
				return true
			}
		}
	}
	return false
}
