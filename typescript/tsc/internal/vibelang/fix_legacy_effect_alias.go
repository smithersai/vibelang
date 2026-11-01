package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// VIP-3/VIP-14 and decided detail260 retain the old prelude alias only for
// migration. An ordinary local/imported Effect type is never this alias.
var EK4856 = message(4856, warningCategory, "The bare Effect type alias is transitional; write an Effect shorthand type or Effect.Effect instead.")

func init() {
	registry[EK4856.Code] = EK4856
	tsFormMessages = append(tsFormMessages, EK4856)
	tsFormFixCodes = append(tsFormFixCodes, EK4856.Code)
	tsFormRules[EK4856.Code] = &tsFormRule{
		message: EK4856, find: findLegacyEffectAliases,
		plan: legacyEffectAliasRewrite, diagnosed: legacyEffectAliasNode,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4856.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
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
			report(node, legacyEffectAliasRewrite(c, file, node))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
func legacyEffectAliasRewrite(c *checker.Checker, file *ast.SourceFile, node *ast.Node) *formRewrite {
	if !isLegacyEffectAlias(c, file, node) {
		return nil
	}
	if ast.IsTypeReferenceNode(node) && effectShorthandKeepsGrouping(file, node) {
		if rewrite := legacyEffectAliasShorthand(file, node); rewrite.fixable() &&
			editsPreserveComments(file.Text(), rewrite.edits) {
			return rewrite
		}
	}
	// Heritage and infer operands need a named interface. Qualification also
	// keeps comments that a whole-reference shorthand rewrite would discard.
	// Replacing only the identifier retains every original type argument.
	name := legacyEffectAliasName(node)
	namespace := c.ResolveName("Effect", name, ast.SymbolFlagsNamespace, false)
	prelude := preludeSymbol(c, preludeStateOf(c), file, "Effect")
	if namespace == nil || moduleAliasTypeOf(c, namespace, "Effect") != moduleAliasTypeOf(c, prelude, "Effect") {
		return &formRewrite{why: "The Effect namespace is shadowed here; keep the type contract and qualify it through its original namespace."}
	}
	return &formRewrite{
		description: "Effect.Effect" + file.Text()[name.End():node.End()],
		edits:       []sourceEdit{{nodeStart(file, name), name.End(), "Effect.Effect"}},
	}
}

// Migration preserves explicit default slots independently of declaration
// emission. Omitted arguments retain native never defaults.
func legacyEffectAliasShorthand(file *ast.SourceFile, node *ast.Node) *formRewrite {
	arguments := node.TypeArguments()
	if len(arguments) == 0 || len(arguments) > 3 {
		return nil
	}
	slots := make([]string, len(arguments))
	for i, argument := range arguments {
		if ast.NodeIsMissing(argument) || ast.IsInferTypeNode(argument) {
			return nil
		}
		slots[i] = expressionText(file, argument)
	}
	text := strings.Join(slots, "!")
	if len(slots) == 1 {
		text += "!!"
	}
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, node), node.End(), text}}, description: text}
}
