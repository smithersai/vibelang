package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// generatorGlobalConstructors preserves a native constructor when an Effect
// generator becomes explicit effect code. EK1002 suppresses the body's
// TypeScript errors, so the proposal must preserve the global constructor even
// when an implicit prelude name resolves to a non-constructable namespace.
// Local and imported bindings keep their original meaning. This does not exempt
// the global from the platform boundary (VIP-33).
func generatorGlobalConstructors(c *checker.Checker, file *ast.SourceFile, body *ast.Node) ([]sourceEdit, string) {
	var edits []sourceEdit
	var why string
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsNewExpression(node) {
			name := ast.SkipParentheses(node.Expression())
			if ast.IsIdentifier(name) && !shadowedByValue(name, name.Text()) {
				global := c.GlobalSymbol(name.Text(), ast.SymbolFlagsValue)
				resolved := c.ResolveName(name.Text(), name, ast.SymbolFlagsValue, false)
				if global != nil && resolved != nil && resolved != global &&
					global.Flags()&ast.SymbolFlagsFunctionScopedVariable != 0 &&
					len(c.GetSignaturesOfType(c.GetTypeOfSymbol(global), checker.SignatureKindConstruct)) != 0 &&
					len(c.GetSignaturesOfType(c.GetTypeAtLocation(name), checker.SignatureKindConstruct)) == 0 {
					root := c.ResolveName("globalThis", name, ast.SymbolFlagsValue, false)
					if root == nil || root.Name() != "globalThis" || len(root.Declarations()) != 0 {
						why = "the global constructor " + name.Text() + " would be hidden by the prelude, and globalThis is shadowed"
						return true
					}
					at := nodeStart(file, name)
					edits = append(edits, sourceEdit{at, at, "globalThis."})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	visit(body)
	return edits, why
}
