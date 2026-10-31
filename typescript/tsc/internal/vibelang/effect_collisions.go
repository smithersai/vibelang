package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

type collisionModulesKey struct{}

func collisionModules(c *checker.Checker) map[*ast.Node]string {
	return c.ExtensionState(collisionModulesKey{}, func() any { return map[*ast.Node]string{} }).(map[*ast.Node]string)
}
func init() { checker.RegisterMissingPropertyHook(effectCollisionProperty) }

// VIP-14 keeps ECMAScript and TypeScript globals and exposes colliding
// Effect modules through Effect.M. Resolve by binding so a local Effect
// object keeps its own meaning.
func effectCollisionProperty(c *checker.Checker, node *ast.Node, receiver *checker.Type, name string) *ast.Symbol {
	file := ast.GetSourceFileOfNode(node)
	root, ok := effectRootNames[name]
	if !ok || !root.namespace || !isVibeLangFile(file) || !ast.IsPropertyAccessExpression(node) ||
		!(isBuiltinGlobal(c, name) || name == "Record" || name == "Iterable") {
		return nil
	}
	state := preludeStateOf(c)
	effect := preludeSymbol(c, state, file, "Effect")
	actual := c.GetSymbolAtLocation(node.Expression())
	if effect == nil || actual == nil || aliasTarget(c, actual) != aliasTarget(c, effect) {
		return nil
	}
	symbol := effectExportSymbol(c, state, file, name)
	if symbol != nil {
		collisionModules(c)[node] = root.module
	}
	return symbol
}
