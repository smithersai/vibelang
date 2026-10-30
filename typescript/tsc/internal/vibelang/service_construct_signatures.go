package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var serviceConstructSignatureDiagnostic = message(902, errorCategory, "A construct signature cannot be a service member. Declare a named factory method such as create(), or a property whose value is a constructor.")

func init() {
	registry[serviceConstructSignatureDiagnostic.Code] = serviceConstructSignatureDiagnostic
	fileChecks = append(fileChecks, checkServiceConstructSignatures)
}

// Class-member parsing retains new() as a method. In VIP-9's interface-style
// service body it is a construct signature; quoted, computed and optional
// property names still denote methods.
func isServiceConstructSignature(class, member *ast.Node) bool {
	if declarationWord(class) != "service" || serviceShape(class) != nil ||
		!ast.IsMethodDeclaration(member) || member.Body() != nil ||
		member.Name() == nil || !ast.IsIdentifier(member.Name()) || member.Name().Text() != "new" {
		return false
	}
	method := member.AsMethodDeclaration()
	if method.PostfixToken != nil || method.AsteriskToken != nil {
		return false
	}
	for _, modifier := range member.ModifierNodes() {
		if modifier.Flags&ast.NodeFlagsReparsed == 0 {
			return false
		}
	}
	return true
}

func checkServiceConstructSignatures(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) || ast.IsClassExpression(node) {
			for _, member := range node.Members() {
				if isServiceConstructSignature(node, member) {
					report(c, member.Name(), serviceConstructSignatureDiagnostic)
					cover(c, member)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
