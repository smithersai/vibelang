package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"slices"
)

// The expected type of a lambda is the declared, uninstantiated parameter type
// of the candidate signature its call is being checked against (design D44):
// in ids.map((id) => find(id)), map declares (value: T, ...) => U, a plain
// function type, whatever U is inferred to be. The instantiated contextual
// type is used only where the declared type says nothing, as with a bare type
// parameter that another argument fixes, such as Layer.succeed's NoInfer<S>,
// and where explicit type arguments fix the signature, as in vi.fn<Invoke>(…):
// nothing is inferred from the lambda then.

// expectedAt returns the types expected at path below the arguments of call
// when they are checked against signature. fn is the lambda at the end of the
// path, whose contextual type is the fallback.
func (a *analyzer) expectedAt(call *ast.Node, signature *checker.Signature, path []pathStep, fn *ast.Node) []*checker.Type {
	if len(call.TypeArguments()) > 0 {
		if useful := a.expectedFrom(signature, path); len(useful) > 0 {
			return useful
		}
	}
	if declared := a.declaredSignature(signature); declared != nil {
		if useful := a.expectedFrom(declared, path); len(useful) > 0 {
			return useful
		}
	}
	// D265/S1-4 carry a record's context through a generic parameter to its
	// fields. S5-21 also needs the current candidate's inferred service shape
	// for a direct value (S in provideService(key, value)). Keep D44 for a
	// single bare generic argument: its result context cannot choose a form.
	if len(path) > 1 && !path[len(path)-1].element || len(path) == 1 && len(signature.Parameters()) > 1 {
		if t := a.checker.GetContextualTypeForCandidateArgument(call, signature, path[0].argument); t != nil {
			types := withoutOwnType([]*checker.Type{t}, fn)
			for _, step := range path[1:] {
				types = a.stepInto(types, step)
			}
			if useful := a.usefulTypes(types); len(useful) > 0 && a.classify(useful).any() {
				return useful
			}
		}
	}
	return a.contextualTypes(fn)
}

// expectedFrom returns the types that signature's parameter at path expects,
// when they ask for a form.
func (a *analyzer) expectedFrom(signature *checker.Signature, path []pathStep) []*checker.Type {
	t := a.checker.GetTypeAtPosition(signature, path[0].argument)
	if t == nil {
		return nil
	}
	types := []*checker.Type{t}
	for _, step := range path[1:] {
		types = a.stepInto(types, step)
	}
	if useful := a.usefulTypes(types); len(useful) > 0 && a.classify(useful).any() {
		return useful
	}
	return nil
}

// declaredSignature returns the uninstantiated signature behind a candidate.
func (a *analyzer) declaredSignature(signature *checker.Signature) *checker.Signature {
	if d := signature.Declaration(); d != nil && !ast.IsJSDocSignature(d) && ast.IsFunctionLike(d) {
		declared := a.checker.GetSignatureFromDeclaration(d)
		// A method of an Effect data type (datamethods.go) is its function's
		// data-first form with self as this, so its arguments start one later.
		if signature.ThisParameter() != nil && takesSelfFirst(declared) && len(signature.Parameters()) == len(declared.Parameters())-1 {
			if method := a.checker.SignatureWithThisFromFirstParameter(declared); method != nil {
				return method
			}
		}
		return declared
	}
	for signature.Target() != nil {
		signature = signature.Target()
	}
	return signature
}

// contextualTypes returns the type TypeScript expects at node, instantiated
// with whatever inference has found so far, as for a contextual signature.
func (a *analyzer) contextualTypes(node *ast.Node) []*checker.Type {
	var t *checker.Type
	if node.Parent != nil && ast.IsShorthandPropertyAssignment(node.Parent) && node.Parent.Name() == node {
		t = a.checker.GetContextualTypeForObjectLiteralElement(node.Parent, checker.ContextFlagsSignature)
	} else {
		t = a.checker.GetContextualType(node, checker.ContextFlagsSignature)
	}
	if t == nil {
		return nil
	}
	if parent := node.Parent; parent != nil && (ast.IsPropertyAssignment(parent) || ast.IsShorthandPropertyAssignment(parent) || ast.IsObjectLiteralExpression(parent)) {
		t = a.declaredMemberType(t)
	}
	return withoutOwnType([]*checker.Type{t}, node)
}

// withoutOwnType drops fn's own type from types. After inference, the
// instantiated type of a type parameter that fn fixed is fn's own type, as for
// the lambda in check(() => make()) with check<T>(actual: T). It says nothing
// about fn's form, and reading its return type would re-enter fn's own return
// type (TS7024).
func withoutOwnType(types []*checker.Type, fn *ast.Node) []*checker.Type {
	var out []*checker.Type
	for _, t := range types {
		if t.Flags()&checker.TypeFlagsUnion != 0 && slices.ContainsFunc(t.Types(), func(member *checker.Type) bool {
			return isTypeOfDeclaration(member, fn)
		}) {
			for _, member := range t.Types() {
				if !isTypeOfDeclaration(member, fn) {
					out = append(out, member)
				}
			}
			continue
		}
		if !isTypeOfDeclaration(t, fn) {
			out = append(out, t)
		}
	}
	return out
}

// isTypeOfDeclaration reports whether t is the type of the function or class
// that node declares.
func isTypeOfDeclaration(t *checker.Type, node *ast.Node) bool {
	symbol := t.Symbol()
	return symbol != nil && slices.Contains(symbol.Declarations(), node)
}

func (a *analyzer) stepInto(types []*checker.Type, step pathStep) []*checker.Type {
	var out []*checker.Type
	for _, t := range types {
		if step.element {
			out = append(out, a.elementTypes(t, 0)...)
		} else {
			out = append(out, a.propertyTypes(t, step.property, 0)...)
		}
	}
	return out
}

// usefulTypes drops bare type parameters, which say nothing about form.
func (a *analyzer) usefulTypes(types []*checker.Type) []*checker.Type {
	var out []*checker.Type
	for _, t := range types {
		if !a.isBareTypeParameter(t) {
			out = append(out, t)
		}
	}
	return out
}

// isBareTypeParameter reports whether t is a type parameter, possibly wrapped
// in NoInfer, whose constraint says nothing.
func (a *analyzer) isBareTypeParameter(t *checker.Type) bool {
	t = unwrapSubstitution(t)
	if t.Flags()&checker.TypeFlagsTypeParameter == 0 {
		return false
	}
	constraint := a.checker.GetBaseConstraintOfType(t)
	return constraint == nil || constraint == t || constraint.Flags()&checker.TypeFlagsUnknown != 0
}

func unwrapSubstitution(t *checker.Type) *checker.Type {
	for t.Flags()&checker.TypeFlagsSubstitution != 0 {
		t = t.AsSubstitutionType().BaseType()
	}
	return t
}

// expectation lists the forms a set of expected types accepts.
type expectation struct {
	program  bool // an Effect value
	effectFn bool // a function that returns an Effect
	plainFn  bool // a function that returns something else
}

func (e expectation) any() bool { return e.program || e.effectFn || e.plainFn }

// classify reads which forms the types accept. A union of an Effect and a
// function type accepts both (design D39).
func (a *analyzer) classify(types []*checker.Type) expectation {
	var e expectation
	var visit func(t *checker.Type, depth int)
	visit = func(t *checker.Type, depth int) {
		t = unwrapSubstitution(t)
		if depth > 4 {
			return
		}
		switch {
		case t.Flags()&checker.TypeFlagsUnion != 0:
			for _, member := range t.Types() {
				visit(member, depth+1)
			}
			return
		case t.Flags()&checker.TypeFlagsTypeParameter != 0:
			if constraint := a.checker.GetBaseConstraintOfType(t); constraint != nil && constraint != t && constraint.Flags()&checker.TypeFlagsUnknown == 0 {
				visit(constraint, depth+1)
			}
			return
		}
		if t == a.checker.GetGlobalFunctionType() {
			// Function, as React's useCallback<T extends Function> declares:
			// TypeScript types a literal there as a plain function (D513).
			e.plainFn = true
			return
		}
		signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall)
		if len(signatures) == 0 {
			if a.isExpectedEffect(t) {
				e.program = true
			}
			return
		}
		for _, s := range signatures {
			switch returned := unwrapSubstitution(a.checker.GetReturnTypeOfSignature(s)); {
			case a.isExpectedEffect(returned):
				e.effectFn = true
			case a.mayBeExpectedEffect(returned):
				// A plain value or an Effect, as Arbitrary.checkEffect's
				// property returns: either function fits (D39).
				e.effectFn, e.plainFn = true, true
			default:
				e.plainFn = true
			}
		}
	}
	for _, t := range types {
		visit(t, 0)
	}
	return e
}

// isExpectedEffect reports whether t, an expected type, is effect's own
// Effect interface, a union of those interfaces (D270), or a type parameter
// constrained to one. A type that
// extends Effect with structure of its own, such as Config or Exit, is data
// (D24): a callback expected to return a Config returns the Config and stays
// plain, as Config.orElse's fallback does.
func (a *analyzer) isExpectedEffect(t *checker.Type) bool {
	if t.Flags()&(checker.TypeFlagsTypeParameter|checker.TypeFlagsIndexedAccess|checker.TypeFlagsConditional) != 0 {
		constraint := a.checker.GetBaseConstraintOfType(t)
		return constraint != nil && constraint != t && a.isExpectedEffect(constraint)
	}
	// Expected program positions retain constrained union members (D147);
	// ordinary running calls require exact-Effect members instead (D24/D270).
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !a.isExpectedEffect(member) {
				return false
			}
		}
		return len(t.Types()) > 0
	}
	if !isEffectType(a.checker, t) {
		return false
	}
	if a.effectInterface == nil {
		a.effectInterface = effectInterface(a.checker, t)
	}
	return true
}

// mayBeExpectedEffect reports whether t, an expected type, is a union with a
// member that isExpectedEffect accepts, such as boolean | Effect<boolean>.
func (a *analyzer) mayBeExpectedEffect(t *checker.Type) bool {
	if t.Flags()&checker.TypeFlagsUnion == 0 {
		return false
	}
	for _, member := range t.Types() {
		if a.isExpectedEffect(member) {
			return true
		}
	}
	return false
}

// elementTypes returns what iterating t yields, for an array literal element's
// expected type: index signature types, else the first type argument.
func (a *analyzer) elementTypes(t *checker.Type, depth int) []*checker.Type {
	t = unwrapSubstitution(t)
	if depth > 4 {
		return nil
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		var out []*checker.Type
		for _, member := range t.Types() {
			out = append(out, a.elementTypes(member, depth+1)...)
		}
		return out
	}
	if t.Flags()&checker.TypeFlagsTypeParameter != 0 {
		if constraint := a.checker.GetBaseConstraintOfType(t); constraint != nil && constraint != t {
			return a.elementTypes(constraint, depth+1)
		}
		return nil
	}
	var out []*checker.Type
	for _, info := range a.checker.GetIndexInfosOfType(t) {
		out = append(out, info.ValueType())
	}
	if len(out) == 0 && t.Flags()&checker.TypeFlagsObject != 0 && t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		if args := a.checker.GetTypeArguments(t); len(args) > 0 {
			out = append(out, args[0])
		}
	}
	return out
}

// propertyTypes returns the type of property name of t, else its string index
// type, for an object literal property's expected type.
func (a *analyzer) propertyTypes(t *checker.Type, name string, depth int) []*checker.Type {
	t = unwrapSubstitution(t)
	if depth > 4 {
		return nil
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		var out []*checker.Type
		for _, member := range t.Types() {
			out = append(out, a.propertyTypes(member, name, depth+1)...)
		}
		return out
	}
	if t.Flags()&checker.TypeFlagsTypeParameter != 0 {
		if constraint := a.checker.GetBaseConstraintOfType(t); constraint != nil && constraint != t {
			return a.propertyTypes(constraint, name, depth+1)
		}
		return nil
	}
	if p := a.checker.GetTypeOfPropertyOfType(t, name); p != nil {
		return []*checker.Type{a.declaredMemberType(p)}
	}
	if s := a.checker.GetIndexTypeOfType(t, a.checker.GetStringType()); s != nil {
		return []*checker.Type{s}
	}
	return nil
}
