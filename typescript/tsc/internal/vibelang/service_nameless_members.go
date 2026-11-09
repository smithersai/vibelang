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
		if ast.IsClassDeclaration(node) && declarationWord(node) == "service" {
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
				diagnostic := serviceNamelessMemberDiagnostic
				if serviceShape(node) != nil {
					diagnostic = diagnostic.With("A service with a whole shape cannot declare {0}. Put signatures in the shape type and implementation code in a layer.")
				}
				report(c, member, diagnostic, what)
				cover(c, member)
				if member.Kind == ast.KindIndexSignature && ast.IsStatic(member) {
					// The key and default headers would otherwise report TS2411 against it.
					coverCodes(c, node, 2411)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
