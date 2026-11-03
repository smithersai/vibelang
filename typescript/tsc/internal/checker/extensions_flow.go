package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// FlowNarrowingHook can narrow a reference using a language-specific test.
// Return nil to use normal narrowing. narrowAlias applies the same
// assumption using an equivalent reference and its type, without changing
// flow state, to the same test when expr is nil and to expr, an equivalent
// test, otherwise.
type FlowNarrowingHook func(c *Checker, reference *ast.Node, t *Type, test *ast.Node, assumeTrue bool, narrowAlias func(reference *ast.Node, t *Type, expr *ast.Node) *Type) *Type

var flowNarrowingHooks []FlowNarrowingHook

// RegisterFlowNarrowingHook registers an in-tree extension at init time.
func RegisterFlowNarrowingHook(hook FlowNarrowingHook) {
	flowNarrowingHooks = append(flowNarrowingHooks, hook)
}

// IsMatchingReference reports whether two expressions refer to the same value.
func (c *Checker) IsMatchingReference(a, b *ast.Node) bool {
	return c.isMatchingReference(a, b)
}

// NarrowTypeByDiscriminant narrows t, a reference's type, by a test of
// access, a read of one of the reference's properties, as TypeScript narrows
// an object by a test of its tag: narrow narrows the property's type as the
// test does. It returns t unless the property is a discriminant of t, a
// union.
func (c *Checker) NarrowTypeByDiscriminant(t *Type, access *ast.Node, narrow func(*Type) *Type) *Type {
	name, ok := c.getAccessedPropertyName(access)
	if !ok || t.flags&TypeFlagsUnion == 0 || !c.isDiscriminantProperty(t, name) {
		return t
	}
	return c.narrowTypeByDiscriminant(t, access, narrow)
}

// NarrowTypeTo applies a positive or negative type test to t.
func (c *Checker) NarrowTypeTo(t, candidate *Type, assumeTrue bool) *Type {
	return c.getNarrowedType(t, candidate, assumeTrue, false)
}

// NarrowTypeByTest projects a reference type through a test without changing
// the reference's flow type. Coverage checks use it with a generic constraint.
func (c *Checker) NarrowTypeByTest(reference *ast.Node, t *Type, test *ast.Node, assumeTrue bool) *Type {
	f := &FlowState{reference: reference, declaredType: t, initialType: t}
	return c.narrowType(f, t, test, assumeTrue)
}
