package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK1301 (VIP-13, VIP-29; chapter 3 static rules, first row): a constructor
// in an error or schema error body. The declaration's constructor takes its
// fields; a written one gets this one diagnostic, and TypeScript's errors
// inside it are dropped (error_rejected_members.go). EK4814, the Schema-class
// constructor warning, yields to it (lsrules.go).
var EK1301 = message(1301, errorCategory, "An error declaration cannot have a constructor: its fields are the constructor's one argument.")

func init() {
	registry[EK1301.Code] = EK1301
	fileChecks = append(fileChecks, checkErrorConstructors)

}

func checkErrorConstructors(c *checker.Checker, file *ast.SourceFile) {
	for _, member := range errorConstructors(file) {
		if ast.HasSyntacticModifier(member, ast.ModifierFlagsPrivate|ast.ModifierFlagsProtected) {
			coverRejectedSchemaConstructorRegistration(c, member.Parent)
		}
		if restrictedEffectMember(member) {
			continue
		}
		report(c, member, EK1301)
	}
}

// errorConstructors lists the written constructors of every error declaration in file.
func errorConstructors(file *ast.SourceFile) []*ast.Node {
	var found []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			for _, member := range node.Members() {
				if member.Kind == ast.KindConstructor && member.Flags&ast.NodeFlagsReparsed == 0 {
					found = append(found, member)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// A rejected private constructor cannot satisfy the generated matcher's
// constructor constraint. Cover only its synthetic this argument.
func coverRejectedSchemaConstructorRegistration(c *checker.Checker, class *ast.Node) {
	for _, member := range class.Members() {
		if member.Kind != ast.KindClassStaticBlockDeclaration || member.Flags&ast.NodeFlagsReparsed == 0 {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsCallExpression(node) && node.Flags&ast.NodeFlagsReparsed != 0 &&
				isSynthesizedName(node.Expression(), "$schemaErrorMatcher") && len(node.Arguments()) > 0 {
				argument := node.Arguments()[0]
				if argument.Kind == ast.KindThisKeyword && argument.Flags&ast.NodeFlagsReparsed != 0 {
					coverExactCodes(c, argument, 2345)
				}
			}
			return node.ForEachChild(visit)
		}
		visit(member)
	}
}
