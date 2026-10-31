package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// A valid KeyMember or DefaultMember belongs to the service key. It does
// not reserve the same property name on the service's implementation shape.
func serviceStaticIdentityMember(member *ast.Node) bool {
	if !ast.IsPropertyDeclaration(member) || !ast.IsStatic(member) ||
		!ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) ||
		member.PostfixToken() != nil || member.Name() == nil || !ast.IsIdentifier(member.Name()) {
		return false
	}
	for _, modifier := range member.ModifierNodes() {
		if modifier.Flags&ast.NodeFlagsReparsed == 0 &&
			modifier.Kind != ast.KindStaticKeyword && modifier.Kind != ast.KindReadonlyKeyword {
			return false
		}
	}
	switch member.Name().Text() {
	case "key":
		return member.Initializer() != nil && ast.IsStringLiteral(member.Initializer())
	case "defaultValue":
		return member.Initializer() != nil
	}
	return false
}
