package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

type concurrentItemSourceTypesKey struct{}

func concurrentItemSourceTypes(c *checker.Checker) map[*ast.Node]*checker.Type {
	return c.ExtensionState(concurrentItemSourceTypesKey{}, func() any {
		return map[*ast.Node]*checker.Type{}
	}).(map[*ast.Node]*checker.Type)
}

func init() { checker.RegisterExpressionTypeHook(concurrentItemType) }

// A source head destructures the iterated value directly. Generic callback
// inference erases object-literal identity, which TypeScript uses to allow a
// missing property with a binding default.
func concurrentItemType(c *checker.Checker, node *ast.Node, fallback *checker.Type) *checker.Type {
	if call := node.Parent; fiberHelper(call) == "$forConcurrent" && len(call.Arguments()) == 3 && call.Arguments()[0] == node {
		// Observe the ordinary argument check, before generic inference widens
		// its element. Rechecking it from a head binding would introduce a cycle
		// when a RHS closure captures that same source binding.
		concurrentItemSourceTypes(c)[call] = fallback
	}
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsReparsed == 0 || node.Text() != "$concurrentItem" {
		return fallback
	}
	declaration := node.Parent
	if declaration == nil || !ast.IsVariableDeclaration(declaration) || declaration.Initializer() != node || !ast.IsBindingPattern(declaration.Name()) {
		return fallback
	}
	fn := ast.FindAncestor(declaration, isConcurrentBody)
	if fn == nil {
		return fallback
	}
	if iterated := concurrentItemSourceTypes(c)[fn.Parent]; iterated != nil {
		if element := c.IteratedType(iterated); element != nil {
			return element
		}
	}
	return fallback
}
