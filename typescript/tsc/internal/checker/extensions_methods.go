package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// MissingPropertyHook can supply the property named name that receiver, the
// apparent type of the left side of node, does not have. node is a property
// access expression, or the qualified name of an expression in a type query
// (typeof a.b). The checker asks after its own lookup finds nothing, so a
// type's own members always win. It returns nil when it has nothing to say.
type MissingPropertyHook func(c *Checker, node *ast.Node, receiver *Type, name string) *ast.Symbol

var missingPropertyHooks []MissingPropertyHook

// RegisterMissingPropertyHook adds hook to every checker. Call it only from
// the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterMissingPropertyHook(hook MissingPropertyHook) {
	missingPropertyHooks = append(missingPropertyHooks, hook)
}

func (c *Checker) missingPropertyFromHooks(node *ast.Node, receiver *Type, name string) *ast.Symbol {
	for _, hook := range missingPropertyHooks {
		if property := hook(c, node, receiver, name); property != nil {
			return property
		}
	}
	return nil
}

// NewPropertySymbol returns a property named name of type t whose
// declarations are declarations: for a missing property hook to supply, so go
// to definition and hover reach the function the property stands for, or for
// a name resolution hook to resolve a name to a value of type t.
func (c *Checker) NewPropertySymbol(name string, t *Type, declarations []*ast.Node) *ast.Symbol {
	property := c.newSymbol(ast.SymbolFlagsProperty, name)
	property.SetDeclarations(declarations)
	c.valueSymbolLinks.Get(property).resolvedType = t
	return property
}

// SignatureWithThisFromFirstParameter returns signature with its first
// parameter as its this parameter, (self: S, x: X) => R as
// (this: S, x: X) => R, so a method call x.name(…) checks x against S and
// infers type parameters from it. It returns nil for a signature with no
// parameters.
func (c *Checker) SignatureWithThisFromFirstParameter(signature *Signature) *Signature {
	if len(signature.parameters) == 0 {
		return nil
	}
	minArgumentCount := max(int(signature.minArgumentCount)-1, 0)
	// A guard on the first parameter, (self: Option<A>) => self is Some<A>,
	// guards this, so x.isSome() narrows x; a guard on a later parameter
	// moves down one.
	var predicate *TypePredicate
	if p := c.getTypePredicateOfSignature(signature); p != nil {
		switch {
		case p.kind == TypePredicateKindIdentifier && p.parameterIndex == 0:
			predicate = c.newTypePredicate(TypePredicateKindThis, "", 0, p.t)
		case p.kind == TypePredicateKindAssertsIdentifier && p.parameterIndex == 0:
			predicate = c.newTypePredicate(TypePredicateKindAssertsThis, "", 0, p.t)
		case (p.kind == TypePredicateKindIdentifier || p.kind == TypePredicateKindAssertsIdentifier) && p.parameterIndex > 0:
			predicate = c.newTypePredicate(p.kind, p.parameterName, p.parameterIndex-1, p.t)
		default:
			predicate = p
		}
	}
	return c.newSignature(signature.flags, signature.declaration, signature.TypeParameters(), signature.parameters[0], signature.parameters[1:], c.getReturnTypeOfSignature(signature), predicate, minArgumentCount)
}

// NewFunctionType returns an anonymous type with signatures as its call
// signatures and members as its properties.
func (c *Checker) NewFunctionType(members ast.SymbolTable, signatures []*Signature) *Type {
	return c.newAnonymousType(nil, members, signatures, nil, nil)
}

// GetIntersectionType returns the intersection of types.
func (c *Checker) GetIntersectionType(types []*Type) *Type {
	return c.getIntersectionType(types)
}
