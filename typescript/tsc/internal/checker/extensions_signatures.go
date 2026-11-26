package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// SignatureWithReturnType returns signature's type parameters and parameters
// with returnType as the return type, so a language service can show a
// function the way a language built on the checker calls it.
func (c *Checker) SignatureWithReturnType(signature *Signature, returnType *Type) *Signature {
	return c.newSignature(signature.flags, nil /*declaration*/, signature.TypeParameters(), signature.ThisParameter(), signature.parameters, returnType, nil /*resolvedTypePredicate*/, int(signature.minArgumentCount))
}

type signatureChecksKey struct{}

func (c *Checker) signatureChecks() map[*ast.Node]int {
	return c.ExtensionState(signatureChecksKey{}, func() any { return map[*ast.Node]int{} }).(map[*ast.Node]int)
}

// checkContextualSignatureDeclaration checks the signature declaration of
// node, a function expression, arrow function, or object literal method, for
// contextuallyCheckFunctionExpressionOrObjectLiteralMethod, and records that
// it does for IsCheckingSignatureOf.
func (c *Checker) checkContextualSignatureDeclaration(node *ast.Node) {
	checks := c.signatureChecks()
	checks[node]++
	defer func() {
		if checks[node]--; checks[node] == 0 {
			delete(checks, node)
		}
	}()
	c.checkSignatureDeclaration(node)
}

// IsCheckingSignatureOf reports whether c is checking the signature
// declaration of fn, a function expression, arrow function, or object literal
// method: its parameter and return type annotations are being resolved. When
// resolving one of them types fn again, as an annotation that names the
// variable an enclosing call initializes does, an extension's hooks see fn
// before its annotations have types, and resolving them there is a cycle.
func (c *Checker) IsCheckingSignatureOf(fn *ast.Node) bool {
	return c.signatureChecks()[fn] > 0
}

// IsResolvingReturnTypeOf reports whether the return type of signature is
// being inferred from its body. Asking for it there is TypeScript's
// circularity error (TS7024), and the function that encloses the cycle gets
// an implicit any, as its catch bindings do (TS7022).
func (c *Checker) IsResolvingReturnTypeOf(signature *Signature) bool {
	return c.isResolvingReturnTypeOfSignature(signature)
}

// ExcludeType returns Exclude<source, excluded>, as lib.es5.d.ts declares it,
// or source when no such alias is in reach. Effect.provide leaves
// Exclude<R, I> of a requirement R that is a type parameter.
func (c *Checker) ExcludeType(source *Type, excluded *Type) *Type {
	symbol := c.getGlobalTypeAliasSymbol("Exclude", 2, false /*reportErrors*/)
	if symbol == nil {
		return source
	}
	return c.getTypeAliasInstantiation(symbol, []*Type{source, excluded}, nil)
}
