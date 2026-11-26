package checker

// GetBaseSignature instantiates signature's type parameters with their
// constraints, unknown for an unconstrained parameter.
func (c *Checker) GetBaseSignature(signature *Signature) *Signature {
	return c.getBaseSignature(signature)
}

// GetErasedSignature returns signature with each of its type parameters
// replaced by any, as TypeScript compares a generic signature it cannot
// instantiate. A data variant's pattern (D307) narrows a value of no
// declared variant to its erased constructor's result.
func (c *Checker) GetErasedSignature(signature *Signature) *Signature {
	return c.getErasedSignature(signature)
}

// FilterType returns the members of t, a union, for which f holds, as a
// union, or, for any other type, t when f holds and never when it does not.
func (c *Checker) FilterType(t *Type, f func(*Type) bool) *Type {
	return c.filterType(t, f)
}
