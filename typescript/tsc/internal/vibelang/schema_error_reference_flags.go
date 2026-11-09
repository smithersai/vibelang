package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Both source forms map fields to a runtime Schema fields object. Error
// payload fields are implicitly readonly; ordinary structs read source modifiers.
func schemaMappedFieldObject(node *ast.Node) *ast.Node {
	if isSchemaErrorFields(node) {
		// Retired family syntax has its own pending class migration. Do not
		// add a rejection there before that preserving repair is available.
		for parent := node.Parent; parent != nil; parent = parent.Parent {
			if ast.IsClassDeclaration(parent) {
				form, _ := errorFormOf(parent)
				if errorDeclarationBase(parent) && !ast.HasSyntacticModifier(parent, ast.ModifierFlagsAbstract) && errorTagField(parent, form) == parent.Name() {
					return node
				}
				return nil
			}
		}
		return nil
	}
	if isSchemaStruct(node) {
		return node.Arguments()[0]
	}
	return nil
}
