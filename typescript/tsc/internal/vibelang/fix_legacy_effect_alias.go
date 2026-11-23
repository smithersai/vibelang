package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-3/VIP-14 and decided detail260 retain the old prelude alias only for
// migration. An ordinary local/imported Effect type is never this alias.
var EK4856 = message(4856, warningCategory, "The bare Effect type alias is transitional; write an Effect shorthand type or Effect.Effect instead.")

func init() {
	registry[EK4856.Code] = EK4856
	tsFormMessages = append(tsFormMessages, EK4856)
	tsFormRules[EK4856.Code] = &tsFormRule{
		message: EK4856, find: findLegacyEffectAliases,
	}
}
func legacyEffectAliasNode(node *ast.Node) bool {
	return ast.IsTypeReferenceNode(node) || ast.IsExpressionWithTypeArguments(node)
}
func legacyEffectAliasName(node *ast.Node) *ast.Node {
	if ast.IsTypeReferenceNode(node) {
		return node.AsTypeReferenceNode().TypeName
	}
	if ast.IsExpressionWithTypeArguments(node) {
		return node.Expression()
	}
	return nil
}
func isLegacyEffectAlias(c *checker.Checker, file *ast.SourceFile, node *ast.Node) bool {
	name := legacyEffectAliasName(node)
	if name == nil || !ast.IsIdentifier(name) || name.Text() != "Effect" ||
		name.Flags&ast.NodeFlagsReparsed != 0 || node.Flags&ast.NodeFlagsJSDoc != 0 {
		return false
	}
	symbol := c.GetSymbolAtLocation(name)
	prelude := preludeSymbol(c, preludeStateOf(c), file, "Effect")
	if symbol == nil || prelude == nil {
		return false
	}
	// Compare the binding, not its structurally identical instantiated type.
	// moduleAliasType records references resolved through the module shorthand;
	// an explicit imported interface keeps its own alias symbol.
	return symbol == prelude ||
		moduleServiceStateOf(c).typeNames[name] && symbol == moduleAliasTypeOf(c, prelude, "Effect")
}
func findLegacyEffectAliases(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if legacyEffectAliasNode(node) && isLegacyEffectAlias(c, file, node) {
			report(node, nil)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
