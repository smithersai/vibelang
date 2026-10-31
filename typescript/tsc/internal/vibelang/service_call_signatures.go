package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var serviceCallSignatureDiagnostic = message(902, errorCategory, "A call signature cannot be a service member. Declare a named method such as call(x: number): string, or a property whose type is a function.")

func init() {
	registry[serviceCallSignatureDiagnostic.Code] = serviceCallSignatureDiagnostic
	fileChecks = append(fileChecks, checkServiceCallSignatures)
}

// checkServiceCallSignatures reports EK0902 at each call signature of a
// service or control body, which the parser keeps as a member so the rest of
// the body still checks (VIP-9). Its type-only TypeScript errors are covered.
func checkServiceCallSignatures(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) || ast.IsClassExpression(node) {
			for _, member := range node.Members() {
				if ast.IsCallSignatureDeclaration(member) {
					report(c, member, serviceCallSignatureDiagnostic)
					cover(c, member)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
