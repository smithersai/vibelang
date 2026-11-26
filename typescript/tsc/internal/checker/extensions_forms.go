package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// FunctionExpressionTypeHook can replace t, the type the checker gives fn, a
// function expression, arrow function, or object literal method, each time it
// checks fn with its parameters typed. Inside overload resolution that is once
// per candidate signature the enclosing call is checked against.
type FunctionExpressionTypeHook func(c *Checker, fn *ast.Node, t *Type) *Type

var functionExpressionTypeHooks []FunctionExpressionTypeHook

// RegisterFunctionExpressionTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterFunctionExpressionTypeHook(hook FunctionExpressionTypeHook) {
	functionExpressionTypeHooks = append(functionExpressionTypeHooks, hook)
}

func (c *Checker) applyFunctionExpressionTypeHooks(fn *ast.Node, t *Type) *Type {
	for _, hook := range functionExpressionTypeHooks {
		t = hook(c, fn, t)
	}
	return t
}

// NewFunctionTypeWithReturnType returns a function type with the parameters
// and type parameters of signature and the given return type. A copy of its
// signature keeps that return type: the signature of an optional call such as
// `f?.(x)` is one, and before, its return type was read again from the
// declaration, so the call lost the Effect the type gave it.
func (c *Checker) NewFunctionTypeWithReturnType(symbol *ast.Symbol, signature *Signature, returnType *Type) *Type {
	result := c.cloneSignature(signature)
	result.target = nil
	result.mapper = nil
	result.resolvedReturnType = returnType
	result.ensureExtra(c).givenReturnType = returnType
	return c.newAnonymousType(symbol, nil, []*Signature{result}, nil, nil)
}

// ContextualReturnTypeHook can replace t, the contextual type of what fn
// returns, which return statements, an arrow function's expression body, and
// the inference of fn's return type see. t may be nil. contextual lazily
// supplies the function's contextual type, shared with the signature lookup.
type ContextualReturnTypeHook func(c *Checker, fn *ast.Node, t *Type, contextual func() *Type) *Type

var contextualReturnTypeHooks []ContextualReturnTypeHook

// RegisterContextualReturnTypeHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterContextualReturnTypeHook(hook ContextualReturnTypeHook) {
	contextualReturnTypeHooks = append(contextualReturnTypeHooks, hook)
}

func (c *Checker) applyContextualReturnTypeHooks(fn *ast.Node, t *Type) *Type {
	return c.applyContextualReturnTypeHooksWithContext(fn, t, func() *Type { return c.getContextualType(fn, ContextFlagsSignature) })
}

func (c *Checker) applyContextualReturnTypeHooksWithContext(fn *ast.Node, t *Type, contextual func() *Type) *Type {
	for _, hook := range contextualReturnTypeHooks {
		t = hook(c, fn, t, contextual)
	}
	return t
}

// ReturnInferenceTargetHook can replace target, the return type of call's
// candidate signature, as the type that TypeScript infers the candidate's type
// arguments to from contextual, the call's contextual type, or return nil to
// infer nothing from contextual. An extension whose call does not stand for
// what its signature returns, such as a call whose value is the success of
// the Effect it runs, returns nil.
type ReturnInferenceTargetHook func(c *Checker, call *ast.Node, contextual *Type, target *Type, candidate *Signature) *Type

var returnInferenceTargetHooks []ReturnInferenceTargetHook

// RegisterReturnInferenceTargetHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterReturnInferenceTargetHook(hook ReturnInferenceTargetHook) {
	returnInferenceTargetHooks = append(returnInferenceTargetHooks, hook)
}

func (c *Checker) applyReturnInferenceTargetHooks(call *ast.Node, contextual *Type, target *Type, candidate *Signature) *Type {
	for _, hook := range returnInferenceTargetHooks {
		if target == nil {
			return nil
		}
		target = hook(c, call, contextual, target, candidate)
	}
	return target
}

// AnnotatedReturnInferenceHook can replace t, the type of the return type
// annotation of fn, a context-sensitive function expression, arrow function,
// or object literal method, as the source that inference from fn's
// annotations infers the enclosing call's type arguments from. TypeScript
// infers from the annotation as written; an extension whose annotation asks
// for the body's type returns nil, and nothing is inferred from it.
type AnnotatedReturnInferenceHook func(c *Checker, fn *ast.Node, t *Type) *Type

var annotatedReturnInferenceHooks []AnnotatedReturnInferenceHook

// RegisterAnnotatedReturnInferenceHook adds hook to every checker. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterAnnotatedReturnInferenceHook(hook AnnotatedReturnInferenceHook) {
	annotatedReturnInferenceHooks = append(annotatedReturnInferenceHooks, hook)
}

func (c *Checker) applyAnnotatedReturnInferenceHooks(fn *ast.Node, t *Type) *Type {
	for _, hook := range annotatedReturnInferenceHooks {
		if t = hook(c, fn, t); t == nil {
			return nil
		}
	}
	return t
}
