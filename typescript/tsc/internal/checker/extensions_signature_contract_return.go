package checker

// SignatureReturnBeforeOwnTypeArguments classifies a signature through its
// declared constraints before its own type arguments are substituted. Captured
// object arguments are still applied, including parameters used only in metadata.
func (c *Checker) SignatureReturnBeforeOwnTypeArguments(signature *Signature, owners []*Type) *Type {
	// An instantiated signature has lost its own parameters. Stop at the
	// first generic signature so its captured constraint mappings survive.
	for signature.Target() != nil && len(signature.TypeParameters()) == 0 {
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
