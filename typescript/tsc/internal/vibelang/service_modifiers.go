package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

var serviceContractModifierDiagnostic = message(902, errorCategory, "A service member is a property or method signature, without class-only modifiers. Remove the modifier; readonly is allowed only on a property.")

// serviceContractClassSyntax recognizes class-only syntax in the written
// instance contracts of VIP-9 services. Ordinary classes, controls, and the
// older typed-shape declaration keep their own member rules.
func serviceContractClassSyntax(member *ast.Node) bool {
	class := member.Parent
	if class == nil || !ast.IsClassDeclaration(class) || declarationWord(class) != "service" ||
		serviceShape(class) != nil || ast.IsStatic(member) || member.Body() != nil ||
		ast.IsPropertyDeclaration(member) && member.Initializer() != nil ||
		!(ast.IsPropertyDeclaration(member) || ast.IsMethodDeclaration(member)) {
		return false
	}
	if member.Name() != nil && ast.IsPrivateIdentifier(member.Name()) ||
		member.Flags&ast.NodeFlagsVibeLangEffect != 0 ||
		ast.IsPropertyDeclaration(member) && member.PostfixToken() != nil && member.PostfixToken().Kind == ast.KindExclamationToken {
		return true
	}
	for _, modifier := range member.ModifierNodes() {
		if modifier.Flags&ast.NodeFlagsReparsed != 0 ||
			modifier.Kind == ast.KindReadonlyKeyword && ast.IsPropertyDeclaration(member) {
			continue
		}
		return true
	}
	return false
}

func init() { registry[serviceContractModifierDiagnostic.Code] = serviceContractModifierDiagnostic }
