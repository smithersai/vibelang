package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// ExpressionTypeHook can replace t, the type the checker gives node, an
// expression, each time it checks node. It runs for every expression the
// checker checks, so it must be cheap, and it returns t when it has nothing
// to say. Function expressions are better served by
// FunctionExpressionTypeHook, which sees them with their parameters typed.
type ExpressionTypeHook func(c *Checker, node *ast.Node, t *Type) *Type

var expressionTypeHooks []ExpressionTypeHook

// RegisterExpressionTypeHook adds hook to every checker. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterExpressionTypeHook(hook ExpressionTypeHook) {
	expressionTypeHooks = append(expressionTypeHooks, hook)
}

func (c *Checker) applyExpressionTypeHooks(node *ast.Node, t *Type) *Type {
	for _, hook := range expressionTypeHooks {
		t = hook(c, node, t)
	}
	return t
}

// CreateArrayType returns Array<elementType>, or ReadonlyArray<elementType>.
func (c *Checker) CreateArrayType(elementType *Type, readonly bool) *Type {
	return c.createArrayTypeEx(elementType, readonly)
}

// MapObjectType returns an object type with the properties and index
// signatures of t, each with the type f gives its type.
func (c *Checker) MapObjectType(t *Type, f func(*Type) *Type) *Type {
	members := make(ast.SymbolTable)
	for _, property := range c.getPropertiesOfType(t) {
		members[property.Name()] = c.createSymbolWithType(property, f(c.getTypeOfSymbol(property)))
	}
	var indexInfos []*IndexInfo
	for _, info := range c.getIndexInfosOfType(t) {
		indexInfos = append(indexInfos, c.newIndexInfo(info.keyType, f(info.valueType), info.isReadonly, info.declaration, nil))
	}
	return c.newAnonymousType(nil /*symbol*/, members, nil /*callSignatures*/, nil /*constructSignatures*/, indexInfos)
}

// IteratedType returns the type that iterating t yields, as a for-of loop
// over t does, or nil when t has no [Symbol.iterator] method.
func (c *Checker) IteratedType(t *Type) *Type {
	types := c.getIterationTypesOfIterable(t, IterationUseElement, nil /*errorNode*/)
	if !types.hasTypes() {
		return nil
	}
	return types.yieldType
}

// CreatePatternExtractionType returns the extracted array or false produced by a matcher.
func (c *Checker) CreatePatternExtractionType(values []*Type) *Type {
	return c.getUnionType([]*Type{c.createArrayTypeEx(c.getUnionType(values), false), c.falseType})
}
