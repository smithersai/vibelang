package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// LegacySyntaxSites exposes compatibility syntax that the current compiler
// can still accept without a diagnostic. The forms audit must reject it even
// while migration support remains. Use resolved service types, not names:
// ordinary objects, shadowing and explicitly acquired services stay valid.
func LegacySyntaxSites(c *checker.Checker, file *ast.SourceFile) []*ast.Node {
	var sites []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsPartOfTypeNode(n) || inHatch(n) {
			return false
		}
		if ast.IsPropertyAccessExpression(n) && isMemberCallSite(n) {
			receiver := c.GetApparentType(c.GetTypeAtLocation(n.Expression()))
			if _, shape := serviceMember(c, n, receiver); shape != nil {
				sites = append(sites, n)
			}
		}
		if n.Kind == ast.KindTryStatement {
			for owner := n.Parent; owner != nil; owner = owner.Parent {
				if isFunctionBoundary(owner) {
					if owner.Flags&ast.NodeFlagsVibeLangEffect != 0 {
						sites = append(sites, n)
					}
					break
				}
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return sites
}
