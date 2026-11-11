package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// IsResolvedCallApplicable reports whether the selected signature accepts the
// call's type arguments and value arguments. Language diagnostics use the same
// tuple, spread and optional-parameter rules as native overload resolution.
func (c *Checker) IsResolvedCallApplicable(call *ast.Node) bool {
	if call == nil || !ast.IsCallExpression(call) {
		return false
	}
	signature := c.getResolvedSignature(call, nil, CheckModeNormal)
	if signature == nil || signature == c.resolvingSignature || signature.flags&SignatureFlagsIsSignatureCandidateForOverloadFailure != 0 {
		return false
	}
	if typeArguments := call.TypeArguments(); len(typeArguments) != 0 {
		candidate := signature
		if signature.target != nil {
			candidate = signature.target
		}
		if !c.hasCorrectTypeArgumentArity(candidate, typeArguments) || c.checkTypeArguments(candidate, typeArguments, false, nil) == nil {
			return false
		}
	}
	args := c.getEffectiveCallArguments(call)
	if !c.hasCorrectArity(call, args, signature, false) || !c.isSignatureApplicable(call, args, signature, c.assignableRelation, CheckModeNormal, false, nil) {
		return false
	}
	if rank := c.candidateRanker(call); rank != nil {
		return rank(signature) >= 0
	}
	return true
}
