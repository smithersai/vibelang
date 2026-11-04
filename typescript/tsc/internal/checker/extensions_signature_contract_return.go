package checker

// SignatureReturnBeforeOwnTypeArguments classifies a signature through its
// declared constraints before its own type arguments are substituted. Captured
// object arguments are still applied, including parameters used only in metadata.
func (c *Checker) SignatureReturnBeforeOwnTypeArguments(signature *Signature, owners []*Type) *Type {
	for signature.Target() != nil {
		signature = signature.Target()
	}
	result := c.GetReturnTypeOfSignature(signature)
	parameters := signature.TypeParameters()
	if len(parameters) != 0 {
		constraints := make([]*Type, len(parameters))
		for i, parameter := range parameters {
			constraints[i] = c.getBaseConstraintOfType(parameter)
			if constraints[i] == nil {
				constraints[i] = c.GetUnknownType()
			}
		}
		result = c.instantiateType(result, newTypeMapper(parameters, constraints))
	}
	return c.InstantiateWrittenSignatureType(nil, result, owners)
}
