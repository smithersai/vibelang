package checker

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
