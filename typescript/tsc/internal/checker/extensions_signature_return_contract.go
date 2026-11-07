package checker

type signatureReturnContractStateKey struct{}

// GetReturnTypeOfSignatureWithoutCallChain reads the selected callable's own
// return contract, retaining its nullable members but excluding optional
// reference evaluation. The native clone preserves inferred, annotated,
// generic and composite signatures without mutating the call's value type.
func (c *Checker) GetReturnTypeOfSignatureWithoutCallChain(sig *Signature) *Type {
	if sig.flags&SignatureFlagsCallChainFlags == 0 {
		return c.getReturnTypeOfSignature(sig)
	}
	cache := c.ExtensionState(signatureReturnContractStateKey{}, func() any {
		return map[*Signature]*Signature{}
	}).(map[*Signature]*Signature)
	raw := cache[sig]
	if raw == nil {
		// cloneSignature deliberately omits call-chain flags and cached
		// return types. Cache the clone before resolving recursive returns.
		raw = c.cloneSignature(sig)
		cache[sig] = raw
	}
	return c.getReturnTypeOfSignature(raw)
}
