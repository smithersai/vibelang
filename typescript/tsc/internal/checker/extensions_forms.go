package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// This file holds the hooks that let an in-tree language extension decide
// what a function expression is while overload resolution checks it against
// each candidate signature, and the few checker operations such an extension
// needs to build the resulting types.

// CallCandidateHook is told that the arguments of call, a call or new
// expression, are about to be checked against candidate, during type argument
// inference or the applicability check of overload resolution. It returns a
// function that the checker calls when that check is done; nested and
// repeated checks of the same call nest their calls.
type CallCandidateHook func(c *Checker, call *ast.Node, candidate *Signature) (done func())

var callCandidateHooks []CallCandidateHook

// RegisterCallCandidateHook adds hook to every checker. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterCallCandidateHook(hook CallCandidateHook) {
	callCandidateHooks = append(callCandidateHooks, hook)
}

func (c *Checker) enterCallCandidate(call *ast.Node, candidate *Signature) func() {
	switch len(callCandidateHooks) {
	case 0:
		return func() {}
	case 1:
		return callCandidateHooks[0](c, call, candidate)
	}
	dones := make([]func(), 0, len(callCandidateHooks))
	for _, hook := range callCandidateHooks {
		dones = append(dones, hook(c, call, candidate))
	}
	return func() {
		for i := len(dones) - 1; i >= 0; i-- {
			dones[i]()
		}
	}
}

// CheckedArgument carries the type already checked under the candidate's
// context, so a filter need not recheck an expression during inference.
type CheckedArgument struct {
	Node   *ast.Node
	Type   *Type
	Target *Type
}

// CandidateFilterHook can reject candidate for call after every argument
// type-checked against it. Overload resolution then treats candidate as if an
// argument did not match and tries the next one. It returns true to accept.
// complete is false while context-sensitive or generic arguments are skipped;
// a decision that depends on their inferences must wait for a complete check.
type CandidateFilterHook func(c *Checker, call *ast.Node, candidate *Signature, arguments []CheckedArgument, complete bool) bool

var candidateFilterHooks []CandidateFilterHook

// RegisterCandidateFilterHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterCandidateFilterHook(hook CandidateFilterHook) {
	candidateFilterHooks = append(candidateFilterHooks, hook)
}

func (c *Checker) acceptCandidateByHooks(call *ast.Node, candidate *Signature, arguments []CheckedArgument, complete bool) bool {
	for _, hook := range candidateFilterHooks {
		if !hook(c, call, candidate, arguments, complete) {
			return false
		}
	}
	return true
}

// CandidateRankingHook enables language-specific overload ranking for call.
// A nil ranker preserves first-applicable selection. Otherwise, the checker
// ranks only fully applicable candidates, keeps the first at an equal rank,
// and treats a negative rank as inapplicable. Ranking runs with candidate's
// argument context active, just like inference and applicability checking.
type CandidateRankingHook func(c *Checker, call *ast.Node) func(candidate *Signature) int

var candidateRankingHooks []CandidateRankingHook

// RegisterCandidateRankingHook adds hook to every checker. Register only
// during an in-tree package's init, before any checker is created.
func RegisterCandidateRankingHook(hook CandidateRankingHook) {
	candidateRankingHooks = append(candidateRankingHooks, hook)
}

func (c *Checker) candidateRanker(call *ast.Node) func(*Signature) int {
	for _, hook := range candidateRankingHooks {
		if rank := hook(c, call); rank != nil {
			return func(candidate *Signature) int {
				defer c.enterCallCandidate(call, candidate)()
				return rank(candidate)
			}
		}
	}
	return nil
}

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
type ReturnInferenceTargetHook func(c *Checker, call *ast.Node, contextual *Type, target *Type) *Type

var returnInferenceTargetHooks []ReturnInferenceTargetHook

// RegisterReturnInferenceTargetHook adds hook to every checker. Call it only
// from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterReturnInferenceTargetHook(hook ReturnInferenceTargetHook) {
	returnInferenceTargetHooks = append(returnInferenceTargetHooks, hook)
}

func (c *Checker) applyReturnInferenceTargetHooks(call *ast.Node, contextual *Type, target *Type) *Type {
	for _, hook := range returnInferenceTargetHooks {
		if target == nil {
			return nil
		}
		target = hook(c, call, contextual, target)
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

// FunctionHasImplicitReturn reports whether fn can reach its end without
// returning or throwing, including the checker's exhaustive-switch analysis.
func (c *Checker) FunctionHasImplicitReturn(fn *ast.Node) bool {
	return c.functionHasImplicitReturn(fn)
}
