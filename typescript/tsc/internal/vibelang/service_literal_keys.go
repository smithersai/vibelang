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
		// The header to write has a string-literal initializer and no definite
		// marker: EK0901 explains it, so TypeScript's TS7008 for the implicit any
		// of a missing initializer and TS1255 for a written ! add nothing.
		coverCodes(c, member, 7008, 1255)
		// The rejected key can also invalidate the generated base static side.
		coverExactCodes(c, class.Name(), 2417)
	}
	return true
}

func init() { registry[serviceLiteralKeyDiagnostic.Code] = serviceLiteralKeyDiagnostic }
