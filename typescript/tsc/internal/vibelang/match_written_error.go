package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A migrated error class owns the same runtime tag matcher as its declaration.
// Recognize only that exact registration, with a matching literal instance tag;
// arbitrary written matchers retain ordinary-class coverage and extraction.
func isExtractedErrorClass(c *checker.Checker, decl *ast.Node) bool {
	if isParsedExtractedErrorClass(decl) {
		return true
	}
	if decl == nil || !ast.IsClassDeclaration(decl) && !ast.IsClassExpression(decl) || decl.Name() == nil {
		return false
	}
	tag := ""
	registered := false
	for _, member := range decl.Members() {
		// Instance members do not replace the constructor's own tag matcher.
		if member.Kind != ast.KindClassStaticBlockDeclaration && !ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) {
			continue
		}
		if ast.IsPropertyDeclaration(member) && (member.Flags&ast.NodeFlagsAmbient != 0 || ast.HasSyntacticModifier(member, ast.ModifierFlagsAmbient)) && member.Initializer() == nil {
			continue
		}
		if member.Kind != ast.KindClassStaticBlockDeclaration {
			return false
		}
		statements := member.AsClassStaticBlockDeclaration().Body.Statements()
		if len(statements) == 0 {
			return false
		}
		for _, statement := range statements {
			if !ast.IsExpressionStatement(statement) {
				return false
			}
			call := ast.SkipParentheses(statement.Expression())
			if !ast.IsCallExpression(call) {
				return false
			}
			name := runtimeExportOf(c, ast.SkipParentheses(call.Expression()))
			args := call.Arguments()
			if len(args) == 0 || args[0].Kind != ast.KindThisKeyword {
				return false
			}
			switch name {
			case "$schemaErrorMatcher":
				if registered || len(args) < 2 || len(args) > 3 || args[1].Kind != ast.KindStringLiteral ||
					len(args) == 3 && args[2].Kind != ast.KindTrueKeyword {
					return false
				}
				tag, registered = args[1].Text(), true
			case "$schemaErrorMember", "$schemaErrorFamily":
				if len(args) != 1 {
					return false
				}
			default:
				return false
			}
		}
	}
	if !registered {
		return false
	}
	symbol := c.GetSymbolAtLocation(decl.Name())
	if symbol == nil {
		return false
	}
	constructors := c.GetConstructSignatures(c.GetTypeOfSymbolAtLocation(symbol, decl.Name()))
	if len(constructors) == 0 {
		return false
	}
	instanceTag := c.GetTypeOfPropertyOfType(c.GetReturnTypeOfSignature(constructors[0]), "_tag")
	expected := c.GetStringLiteralType(tag)
	return instanceTag != nil && instanceTag.Flags()&checker.TypeFlagsStringLiteral != 0 &&
		c.IsTypeAssignableTo(instanceTag, expected) && c.IsTypeAssignableTo(expected, instanceTag)
}
