package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-9 permits named property/method signatures, KeyMember and DefaultMember.
// Index signatures and constructors are class members without a Name node;
// the ordinary named-member contract checks cannot validate them.
var serviceNamelessMemberDiagnostic = message(902, errorCategory, "A service cannot declare {0}; declare named properties and methods, and put implementations in a layer.")

func init() {
	registry[serviceNamelessMemberDiagnostic.Code] = serviceNamelessMemberDiagnostic
	fileChecks = append(fileChecks, checkServiceNamelessMembers)
}

func checkServiceNamelessMembers(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) && declarationWord(node) == "service" && serviceShape(node) == nil {
			for _, member := range node.Members() {
				var what string
				switch member.Kind {
				case ast.KindIndexSignature:
					what = "an index signature"
				case ast.KindConstructor:
					what = "a constructor"
				default:
					continue
				}
				report(c, member, serviceNamelessMemberDiagnostic, what)
				cover(c, member)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
