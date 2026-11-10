package checker

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// proofStatementSignature returns the signature that types node when node is
// the call of a proof statement (VIP-43, Appendix F "Proof statements"), and
// nil for any other call. The parser flags these calls by their syntax, so the
// callee's own binding plays no part: the call is checked as a call of a
// function with the statement's parameter type, and a wrong argument is
// TypeScript's TS2345 or TS2554, as the TypeScript projection reports it.
//
//	assume(P), assert(Q), invariant(P)   (condition: boolean) => void
//	decreases(E)                          (measure: number | bigint) => void
//	ensures((r) => Q)                     (postcondition: (r: R) => boolean) => void
//
// R is the written return type of the function that holds the proof block;
// without one, rule 4309 applies and r is any.
func (c *Checker) proofStatementSignature(node *ast.Node) *Signature {
	if node.Flags&ast.NodeFlagsVibeLangProof == 0 || !ast.IsCallExpression(node) || !ast.IsIdentifier(node.Expression()) {
		return nil
	}
	var name string
	var parameter *Type
	switch node.Expression().Text() {
	case "assume", "assert", "invariant":
		name, parameter = "condition", c.booleanType
	case "decreases":
		name, parameter = "measure", c.getUnionType([]*Type{c.numberType, c.bigintType})
	case "ensures":
		name, parameter = "postcondition", c.proofPostconditionType(node)
	default:
		return nil
	}
	return c.newSignature(SignatureFlagsNone, nil, nil, nil, []*ast.Symbol{c.newParameter(name, parameter)}, c.voidType, nil, 1)
}

// proofPostconditionType is the type of ensures's argument at node: a function
// from the enclosing function's written return type to boolean.
func (c *Checker) proofPostconditionType(node *ast.Node) *Type {
	result := c.anyType
	if fn := ast.GetContainingFunction(node); fn != nil && fn.Type() != nil {
		result = c.getTypeFromTypeNode(fn.Type())
	}
	signature := c.newSignature(SignatureFlagsNone, nil, nil, nil, []*ast.Symbol{c.newParameter("r", result)}, c.booleanType, nil, 1)
	return c.newAnonymousType(nil, nil, []*Signature{signature}, nil, nil)
}

// isProofStatementCallee reports whether node is the callee of a proof
// statement's call, which names no binding: no scope is searched for it.
func isProofStatementCallee(node *ast.Node) bool {
	parent := node.Parent
	return ast.IsIdentifier(node) && parent != nil && ast.IsCallExpression(parent) && parent.Expression() == node && parent.Flags&ast.NodeFlagsVibeLangProof != 0
}

// proofStatementCalleeType is the type of node when node is the callee of a
// proof statement: a function with the statement's signature, as the
// TypeScript projection declares it. It is nil for any other node.
func (c *Checker) proofStatementCalleeType(node *ast.Node) *Type {
	if !isProofStatementCallee(node) {
		return nil
	}
	if signature := c.proofStatementSignature(node.Parent); signature != nil {
		return c.newAnonymousType(nil, nil, []*Signature{signature}, nil, nil)
	}
	return nil
}

// inErasedProofCode reports whether node is in a proof block or a spec
// function (VIP-43), code that erases from the emitted JavaScript. A
// reference there keeps no import: the JavaScript is the program's without
// them, import elision included (Appendix F "Erasure").
func inErasedProofCode(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if n.Kind == ast.KindBlock && n.Flags&ast.NodeFlagsVibeLangProof != 0 || n.Kind == ast.KindFunctionDeclaration && n.Flags&ast.NodeFlagsVibeLangSpec != 0 {
			return true
		}
	}
	return false
}
