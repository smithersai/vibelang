package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A computed member with a literal key type still has a property identity. Native
// object members with the same spelling have their own symbols.
func relicContinuationSymbol(c *checker.Checker, n *ast.Node) *ast.Symbol {
	if ast.IsIdentifier(n) {
		if n.Parent != nil && ast.IsShorthandPropertyAssignment(n.Parent) && n.Parent.Name() == n {
			return c.GetShorthandAssignmentValueSymbol(n.Parent)
		}
		return c.GetSymbolAtLocation(n)
	}
	if ast.IsElementAccessExpression(n) {
		argument := n.AsElementAccessExpression().ArgumentExpression
		if argument == nil {
			return nil
		}
		key := c.GetTypeAtLocation(argument)
		if key != nil && key.IsStringLiteral() {
			if receiver := c.GetTypeAtLocation(n.Expression()); receiver != nil {
				return c.GetPropertyOfType(receiver, key.AsLiteralType().Value().(string))
			}
		}
	}
	return nil
}

// A namespace exported as Control is an ordinary module binding, not the
// continuation base class. Resolve aliases before testing its declaration kind.
func relicContinuationTargets(c *checker.Checker, file *ast.SourceFile) map[*ast.Symbol]bool {
	targets := map[*ast.Symbol]bool{}
	for _, name := range []string{"Control", "handle", "resume", "resumeWith", "abandon"} {
		if symbol := preludeSymbol(c, preludeStateOf(c), file, name); symbol != nil {
			if relicContinuationExport(c, name, symbol) {
				targets[aliasTarget(c, symbol)] = true
			}
		}
	}
	// The kernel entry declares its own continuation functions; Appendix B
	// retires every resolved continuation-runtime name, not only the root's.
	if kernel := resolvedModuleSymbol(c, map[*ast.SourceFile]*ast.Symbol{}, file, runtimeModule+"/kernel"); kernel != nil {
		for _, name := range []string{"handle", "resume", "resumeWith", "abandon"} {
			if symbol := c.TryGetMemberInModuleExports(name, kernel); symbol != nil {
				targets[aliasTarget(c, symbol)] = true
			}
		}
	}
	return targets
}

// relicContinuationExport classifies only the actual runtime/prelude exports.
// Ordinary local symbols and namespaces with the same spelling stay native.
func relicContinuationExport(c *checker.Checker, name string, symbol *ast.Symbol) bool {
	switch name {
	case "Control":
		return aliasTarget(c, symbol).Flags()&ast.SymbolFlagsClass != 0
	case "handle", "resume", "resumeWith", "abandon":
		return true
	}
	return false
}

// A finite union of property keys can still select a retired runtime export.
// Check each possible property by symbol identity; a native object with the
// same keys has independent symbols and remains ordinary TypeScript.
func relicRetiredProperty(c *checker.Checker, receiver, key *checker.Type, targets map[*ast.Symbol]bool) bool {
	if receiver == nil || key == nil {
		return false
	}
	if key.IsUnion() {
		for _, member := range key.Types() {
			if relicRetiredProperty(c, receiver, member, targets) {
				return true
			}
		}
	} else if key.IsStringLiteral() {
		symbol := c.GetPropertyOfType(receiver, key.AsLiteralType().Value().(string))
		return symbol != nil && targets[aliasTarget(c, symbol)]
	}
	return false
}

func relicContinuationReference(c *checker.Checker, n *ast.Node, targets map[*ast.Symbol]bool) bool {
	if symbol := relicContinuationSymbol(c, n); symbol != nil && targets[aliasTarget(c, symbol)] {
		return true
	}
	if ast.IsElementAccessExpression(n) {
		argument := n.AsElementAccessExpression().ArgumentExpression
		if argument != nil {
			return relicRetiredProperty(c, c.GetTypeAtLocation(n.Expression()), c.GetTypeAtLocation(argument), targets)
		}
	}
	return false
}
