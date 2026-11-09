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

// A source head declares from the native iterated value. Generic callback
// inference can erase any or object-literal identity before that declaration.
func concurrentItemType(c *checker.Checker, node *ast.Node, fallback *checker.Type) *checker.Type {
	if call := node.Parent; fiberHelper(call) == "$forConcurrent" && len(call.Arguments()) == 3 && call.Arguments()[0] == node {
		// Observe the ordinary argument check, before generic inference widens
		// its element. Rechecking it from a head binding would introduce a cycle
		// when a RHS closure captures that same source binding.
		concurrentItemSourceTypes(c)[call] = fallback
	}
	if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsVibeLangTemporary == 0 {
		return fallback
	}
	declaration := node.Parent
	if declaration == nil || !ast.IsVariableDeclaration(declaration) || declaration.Initializer() != node {
		return fallback
	}
	fn := ast.FindAncestor(declaration, isConcurrentBody)
	if fn == nil || len(fn.Parameters()) != 1 {
		return fallback
	}
	parameter := fn.Parameters()[0].Name()
	if !ast.IsIdentifier(parameter) || parameter.Flags&ast.NodeFlagsVibeLangTemporary == 0 || parameter.Text() != node.Text() {
		return fallback
	}
	if iterated := concurrentItemSourceTypes(c)[fn.Parent]; iterated != nil {
		if element := c.IteratedType(iterated); element != nil {
			return element
		}
		// The operand is not an Iterable, which EK1901 reports. TypeScript gives
		// the element of such a for...of the error type, so the head pattern and
		// the body add no error derived from an unknown item.
		return c.GetErrorType()
	}
	return fallback
}
