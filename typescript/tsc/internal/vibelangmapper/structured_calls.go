package vibelangmapper

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// D24 keeps known structured constructors cold. Opaque structural return
// types still require native checking; a spelling alone is not a contract.
func (p *projector) structuredCall(call *ast.Node) bool {
	r := p.forms.(*Resolver)
	canonical := r.Callee(call).Canonical
	switch canonical {
	case "effect/Exit#fail", "effect/Exit#succeed", "effect/Exit#failCause", "effect/Exit#die", "effect/Config#String":
		return true
	}
	callee := call.Expression()
	if ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "unsafe" && ast.IsIdentifier(callee.Expression()) {
		receiver := callee.Expression()
		if decl := r.binding(receiver, receiver.Text()); decl != nil && decl.Type() != nil {
			typ := formsUnwrapType(decl.Type())
			if typ != nil && typ.Kind == ast.KindTypeReference {
				name := typ.AsTypeReferenceNode().TypeName
				if ast.IsIdentifier(name) {
					return r.calleeOf(name, nil, 0).Canonical == "effect/sql/SqlClient#SqlClient"
				}
			}
			return r.typeModuleOf(decl.Type()) == "effect/sql/SqlClient"
		}
	}
	return false
}

func (p *projector) discardedStructuredCall(call *ast.Node) {
	outer := call
	for outer.Parent != nil && ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if outer.Parent != nil && ast.IsExpressionStatement(outer.Parent) {
		p.fiberDiagnostic(call, 4301, "This call returns an Effect subtype, which stays data until it is called, so this statement discards its result without running it. Call the result to run it, or write the return type of what it calls as A!E!R.")
	}
}
