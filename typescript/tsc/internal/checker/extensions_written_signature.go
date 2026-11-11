package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// InstantiateWrittenSignatureType applies a signature's and its containing
// objects' existing substitutions to written metadata such as a foreign @throws
// tag. It resolves that metadata without inferring a new callable contract.
func (c *Checker) InstantiateWrittenSignatureType(signature *Signature, declared *Type, owners []*Type) *Type {
	if declared == nil {
		return nil
	}
	if signature != nil {
		declared = c.instantiateType(declared, signature.mapper)
	}
	// TypeScript may prune a method's mapper when its only use is JSDoc.
	// Retain the containing resolved objects' substitutions for that metadata.
	for i := len(owners) - 1; i >= 0; i-- {
		owner := owners[i]
		// Union, intersection and primitive value owners carry no mapper.
		// Mapper is defined only for these three type representations.
		if owner == nil || owner.flags&(TypeFlagsObject|TypeFlagsTypeParameter|TypeFlagsConditional) == 0 {
			continue
		}
		if owner.objectFlags&ObjectFlagsReference != 0 && owner.Target().objectFlags&ObjectFlagsClassOrInterface != 0 {
			declared = c.instantiateType(declared, newTypeMapper(owner.TargetInterfaceType().TypeParameters(), c.getTypeArguments(owner)))
		} else {
			declared = c.instantiateType(declared, owner.Mapper())
		}
	}
	return declared
}

// ReferenceTypeArgumentUsed reports whether an argument affects the resolved
// TypeScript structure. Written throws metadata is checked separately by the
// caller because TypeScript's variance calculation does not include it.
func (c *Checker) ReferenceTypeArgumentUsed(t *Type, index int) bool {
	variances := c.getVariances(t.Target())
	return index >= len(variances) || variances[index] != VarianceFlagsIndependent
}

// AnonymousInstantiation returns the declared object type that an anonymous or
// mapped object type instantiates, with the types its substitution gives the
// type parameters in scope at that declaration: an alias's own parameters and
// every enclosing parameter the declaration may name. The target is nil for a
// reference and for a type that is not an instantiation.
func (c *Checker) AnonymousInstantiation(t *Type) (target *Type, arguments []*Type) {
	if t == nil || t.flags&TypeFlagsObject == 0 || t.objectFlags&ObjectFlagsReference != 0 || t.objectFlags&ObjectFlagsInstantiated == 0 {
		return nil, nil
	}
	data := t.AsObjectType()
	if data.target == nil || data.mapper == nil {
		return nil, nil
	}
	var declaration *ast.Node
	switch {
	case t.objectFlags&ObjectFlagsInstantiationExpressionType != 0:
		declaration = t.AsInstantiationExpressionType().node
	case t.symbol != nil && len(t.symbol.Declarations()) != 0:
		declaration = t.symbol.Declarations()[0]
	}
	if declaration == nil || !c.typeNodeLinks.Has(declaration) {
		return data.target, nil
	}
	// getObjectTypeInstantiation stored this list when it first instantiated
	// the declaration, and keys each instantiation by these mapped types.
	for _, parameter := range c.typeNodeLinks.Get(declaration).getOuterTypeParameters() {
		arguments = append(arguments, data.mapper.Map(parameter))
	}
	return data.target, arguments
}
