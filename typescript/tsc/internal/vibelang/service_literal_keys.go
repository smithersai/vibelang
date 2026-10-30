package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var serviceLiteralKeyDiagnostic = message(901, errorCategory, "A service key must be a readonly static property initialized with a string literal. Write static readonly key = \"app/Service\".")

// checkServiceLiteralKey applies VIP-9's literal-key rule to a written service
// declaration. It returns false for ordinary Context.Service classes and other
// members, whose existing checks still apply.
func checkServiceLiteralKey(c *checker.Checker, class, member *ast.Node) bool {
	if declarationWord(class) != "service" || !ast.IsPropertyDeclaration(member) ||
		!ast.IsStatic(member) || member.Name() == nil ||
		!ast.IsIdentifier(member.Name()) || member.Name().Text() != serviceKeyName {
		return false
	}
	if !ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) ||
		member.Initializer() == nil || !ast.IsStringLiteral(member.Initializer()) {
		report(c, member, serviceLiteralKeyDiagnostic)
		cover(c, member)
	}
	return true
}

func init() { registry[serviceLiteralKeyDiagnostic.Code] = serviceLiteralKeyDiagnostic }
