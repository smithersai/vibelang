package checker

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// UsingInitializerHook reports whether the initializer of declaration, a
// variable declaration in a `using` list, acquires a resource that a language
// extension releases itself. The checker then skips its check that the
// initializer is a Disposable, null, or undefined, and does not need the
// global Disposable type for it. The declared variable keeps the initializer's
// type.
type UsingInitializerHook func(c *Checker, declaration *ast.Node) bool

var usingInitializerHooks []UsingInitializerHook

// RegisterUsingInitializerHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterUsingInitializerHook(hook UsingInitializerHook) {
	usingInitializerHooks = append(usingInitializerHooks, hook)
}

func (c *Checker) applyUsingInitializerHooks(declaration *ast.Node) bool {
	for _, hook := range usingInitializerHooks {
		if hook(c, declaration) {
			return true
		}
	}
	return false
}

// CheckUsingDisposable checks that the initializer of declaration, a variable
// declaration in a `using` list whose check a hook skipped, gives a
// Disposable, an AsyncDisposable, null, or undefined, or a union of them, as
// `await using` requires, and otherwise reports TS2850. A language
// extension whose `using` releases an AsyncDisposable too calls it once the
// initializer's type is settled.
func (c *Checker) CheckUsingDisposable(declaration *ast.Node) {
	initializer := declaration.Initializer()
	globalDisposableType := c.getGlobalDisposableType()
	globalAsyncDisposableType := c.getGlobalAsyncDisposableType()
	if initializer == nil || globalDisposableType == c.emptyObjectType || globalAsyncDisposableType == c.emptyObjectType {
		return
	}
	optionalDisposableType := c.getUnionType([]*Type{globalAsyncDisposableType, globalDisposableType, c.nullType, c.undefinedType})
	widenedInitializerType := c.widenTypeForVariableLikeDeclaration(c.checkExpressionCached(initializer), declaration, false)
	c.checkTypeAssignableTo(widenedInitializerType, optionalDisposableType, initializer,
		diagnostics.The_initializer_of_a_using_declaration_must_be_either_an_object_with_a_Symbol_dispose_method_or_be_null_or_undefined)
}

// IsSyncDisposableType reports whether t is a Disposable, null or undefined,
// the types TypeScript's using disposes without an await.
func (c *Checker) IsSyncDisposableType(t *Type) bool {
	globalDisposableType := c.getGlobalDisposableType()
	if t == nil || globalDisposableType == c.emptyObjectType {
		return false
	}
	return c.isTypeAssignableTo(t, c.getUnionType([]*Type{globalDisposableType, c.nullType, c.undefinedType}))
}
