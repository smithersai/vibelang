package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

var serviceStaticMemberDiagnostic = message(902, errorCategory, "A service declares property and method signatures, static readonly key, and static readonly defaultValue. Move other static members outside the service.")

// serviceStaticMemberRejected leaves the reserved property forms to their
// own key/default checks. Other class statics are not VIP-9 signatures.
func serviceStaticMemberRejected(class, member *ast.Node) bool {
	if declarationWord(class) != "service" || !ast.IsStatic(member) {
		return false
	}
	// The supported transitional default has its own EK4855 migration;
	// rejecting it here would prevent its type/value reads from being repaired.
	if legacyDefault(member) {
		return false
	}
	if ast.IsPropertyDeclaration(member) && member.Name() != nil && ast.IsIdentifier(member.Name()) {
		name := member.Name().Text()
		return name != "key" && name != "defaultValue"
	}
	return true
}

func init() { registry[serviceStaticMemberDiagnostic.Code] = serviceStaticMemberDiagnostic }
