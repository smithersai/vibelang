package checker

// GetErasedSignature returns signature with each of its type parameters
// replaced by any, as TypeScript compares a generic signature it cannot
// instantiate. A data variant's pattern (D307) narrows a value of no
// declared variant to its erased constructor's result.
func (c *Checker) GetErasedSignature(signature *Signature) *Signature {
	return c.getErasedSignature(signature)
}

// GetPermissiveInstantiation returns t with each of its type parameters
// replaced by the wildcard type, which matches every type, as TypeScript
// compares a value with a generic target before inference. A parameter of a
// declared generic signature, such as Like<W> in register<W>(cls: Like<W> |
// Plat), compares with an argument through it.
func (c *Checker) GetPermissiveInstantiation(t *Type) *Type {
	return c.getPermissiveInstantiation(t)
}

// FilterType returns the members of t, a union, for which f holds, as a
// union, or, for any other type, t when f holds and never when it does not.
func (c *Checker) FilterType(t *Type, f func(*Type) bool) *Type {
	return c.filterType(t, f)
}
