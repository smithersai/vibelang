package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The prelude's fork and join, and the hatches sync and callback, take
// their first operand by syntax, so they are reached only through their own
// spellings (rule H4, D330, D432, D452): a call spelled otherwise would read
// its operand by a binding its reader cannot see.

// EK4410: a hatch, or the prelude's fork or join, used other than as the callee of a call under its own name (D330, D432). {0} is the name.
var EK4410 = message(4410, errorCategory, "{0} is used only as the callee of {0}(…), since its first operand is syntax; it cannot be renamed or stored.")

func init() {
	registry[EK4410.Code] = EK4410
	fileChecks = append(fileChecks, checkKeywordBindings)
}

// keywordNames are the prelude bindings whose first operand is syntax: the
// contextual keywords fork and join, and the hatches (D432).
var keywordNames = map[string]bool{"fork": true, "join": true, "sync": true, "callback": true}

// checkKeywordBindings reports EK4410 at each use of the prelude's fork,
// join, sync, or callback other than as the callee of a call spelled
// with its own name: an import that renames one, and any other reference,
// such as const spawn = fork (D330, D432). A call spelled otherwise would
// defer its operand by the callee's resolved symbol, which its reader cannot
// see. A module body is TypeScript, where the runtime's functions are
// ordinary values (D283).
func checkKeywordBindings(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindModuleDeclaration || isHatchArgument(node):
			return false
		case ast.IsImportSpecifier(node):
			imported := node.PropertyNameOrName()
			if imported != nil && keywordNames[imported.Text()] && node.Name().Text() != imported.Text() && isRuntimeSymbol(c, c.GetSymbolAtLocation(node.Name()), imported.Text()) {
				d := report(c, node, EK4410, imported.Text())
				note(d, "Import it under its own name, {0}, and call it as {0}(…).", imported.Text())
			}
			return false
		case ast.IsTypeNode(node) || node.Kind == ast.KindTypeQuery:
			return false
		case ast.IsIdentifier(node) && keywordNames[node.Text()]:
			if isKeywordCallee(node) || isDeclarationName(node) {
				return false
			}
			symbol := c.GetSymbolAtLocation(node)
			if node.Parent != nil && ast.IsShorthandPropertyAssignment(node.Parent) {
				symbol = c.GetShorthandAssignmentValueSymbol(node.Parent)
			}
			if isRuntimeSymbol(c, symbol, node.Text()) {
				d := report(c, node, EK4410, node.Text())
				note(d, "{0}", keywordBindingRepair(node.Text()))
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isKeywordCallee reports whether name is the callee of a call, as fork is
// in fork(e) and fork e, and sync is in sync(…).
func isKeywordCallee(name *ast.Node) bool {
	parent := name.Parent
	return parent != nil && ast.IsCallExpression(parent) && parent.Expression() == name
}

// isDeclarationName reports whether name names what a declaration, a
// property, or an import or export specifier declares, rather than
// referring to a binding.
func isDeclarationName(name *ast.Node) bool {
	parent := name.Parent
	if parent == nil {
		return false
	}
	switch parent.Kind {
	case ast.KindPropertyAccessExpression:
		return false // R.fork, a namespace import's member, refers to the binding (D452)
	case ast.KindQualifiedName:
		return parent.Name() == name
	case ast.KindShorthandPropertyAssignment:
		return false // { fork } refers to fork
	case ast.KindImportSpecifier, ast.KindImportClause, ast.KindNamespaceImport:
		return true
	}
	return ast.IsDeclaration(parent) && parent.Name() == name
}

// isRuntimeSymbol reports whether symbol, through import aliases, is the
// runtime's export name, the binding the prelude gives.
func isRuntimeSymbol(c *checker.Checker, symbol *ast.Symbol, name string) bool {
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil && len(symbol.Declarations()) > 0 {
		declaration = symbol.Declarations()[0]
	}
	if declaration == nil {
		return false
	}
	if symbol.Name() != name {
		return false
	}
	return packageNameOf(c, ast.GetSourceFileOfNode(declaration)) == "vibelang-runtime"
}

// keywordBindingRepair says how to write a use of name, a keyword's
// binding, that EK4410 reports.
func keywordBindingRepair(name string) string {
	switch name {
	case "fork":
		return "Write fork where the fiber starts, fork job(); to pass forking as a function, write (job: () => A!E!R) => fork job()."
	case "join":
		return "Write join where you wait, join fiber; to pass joining as a function, write (fiber: Fiber<A, E>) => join fiber."
	}
	return "Call " + name + " where its TypeScript runs, " + name + "(() => …); in TypeScript, the runtime's " + name + " is an ordinary function."
}

// isPreludeJoin reports whether call is join(x) spelled with parentheses
// whose callee resolves to the prelude's join: the keyword join x with a
// parenthesized operand (D391).
func isPreludeJoin(c *checker.Checker, call *ast.Node) bool {
	return ast.IsCallExpression(call) && len(call.Arguments()) == 1 && isRuntimeExport(c, call.Expression(), "join")
}
