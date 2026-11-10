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
			coverServiceSuperDerivation(c, node)
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
				coverExactErrorCodes(c, member, 2377, 2390)
				if member.Kind == ast.KindIndexSignature {
					coverExactErrorCodes(c, member, 2411)
				}
				if member.Kind == ast.KindIndexSignature && ast.IsStatic(member) {
					// The key and default headers would otherwise report TS2411 against it.
					for _, other := range node.Members() {
						coverExactErrorCodes(c, other, 2411)
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// coverServiceSuperDerivation hides TS2335 ('super' can only be referenced in
// a derived class) for each super that refers to service. A service's twin
// extends Context.Service, so TypeScript accepts super there; only the checked
// class lacks the heritage clause. Every other super error, and any super of a
// nested class, keeps its native code.
func coverServiceSuperDerivation(c *checker.Checker, service *ast.Node) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassLike(node) {
			return false
		}
		if node.Kind == ast.KindSuperKeyword {
			coverExactErrorCodes(c, node, 2335)
		}
		return node.ForEachChild(visit)
	}
	for _, member := range service.Members() {
		member.ForEachChild(visit)
	}
}
