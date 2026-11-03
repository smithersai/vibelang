package checker

// InstantiateTypeParameterDefaults projects a contextual inference target
// through a signature's defaults. Argument inference still uses the original
// signature, so a supplied argument can infer a different type. Earlier
// defaults are substituted into later defaults in declaration order.
func (c *Checker) InstantiateTypeParameterDefaults(t *Type, signature *Signature) *Type {
	if t == nil || signature == nil {
		return t
	}
	var parameters, defaults []*Type
	for _, parameter := range signature.TypeParameters() {
		value := c.getDefaultFromTypeParameter(parameter)
		if value == nil {
			continue
		}
		if len(parameters) != 0 {
			value = c.instantiateType(value, newTypeMapper(parameters, defaults))
		}
		parameters = append(parameters, parameter)
		defaults = append(defaults, value)
	}
	if len(parameters) == 0 {
		return t
	}
	return c.instantiateType(t, newTypeMapper(parameters, defaults))
}
