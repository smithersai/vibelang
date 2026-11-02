package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A primitive TypeScript type can denote a boxed runtime value with a then
// getter. Native async adopts a returned value after the whole body completes,
// including IteratorClose and finally. An Effect.gen success preserves data.
func asyncNeedsReturnAdoption(body *ast.Node) bool {
	needs := func(value *ast.Node) bool {
		if value == nil {
			return false
		}
		value = ast.SkipParentheses(value)
		switch value.Kind {
		case ast.KindNumericLiteral, ast.KindStringLiteral, ast.KindBigIntLiteral,
			ast.KindNoSubstitutionTemplateLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword,
			ast.KindNullKeyword, ast.KindVoidExpression:
			return false
		}
		return true
	}
	if body == nil {
		return false
	}
	if !ast.IsBlock(body) {
		return needs(body)
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if ast.IsReturnStatement(n) && needs(n.Expression()) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(body)
}

func (rc *refactorContext) asyncBridgeModuleVisible(fn *ast.Node) bool {
	symbol := rc.c.ResolveName("Effect", fn.Body(), ast.SymbolFlagsValue, false)
	prelude := preludeSymbol(rc.c, preludeStateOf(rc.c), rc.file, "Effect")
	if symbol == nil && prelude == nil {
		// A file with no Effect references need not load its implicit module
		// before this rewrite. The new effect/tryPromise syntax will load it.
		// An actual source binding (including a type-only import) still
		// prevents that fallback; disabled implicit modules need a value import.
		return !implicitEffectModuleDisabled(rc.c, rc.file, "Effect") && !shadowedByValue(fn.Body(), "Effect")
	}
	if symbol == nil || prelude == nil || resolvedAlias(rc.c, symbol) != resolvedAlias(rc.c, prelude) {
		return false
	}
	explicit := false
	for _, declaration := range symbol.Declarations() {
		if ast.GetSourceFileOfNode(declaration) != rc.file {
			continue
		}
		for node := declaration; node != nil; node = node.Parent {
			if ast.IsImportDeclaration(node) {
				if node.ImportClause() == nil || hasTypeModifier(node, declaration) {
					return false
				}
				explicit = true
				break
			}
		}
	}
	// An internal ResolveName query may still see compiler intrinsics when
	// implicit modules are disabled. Source needs a real value import then.
	return explicit || !implicitEffectModuleDisabled(rc.c, rc.file, "Effect")
}

// Insert around the source, retaining its comments, template contents and
// await edits. The original closing brace closes the inner Effect block.
// Keep directive prologues in the outer function, where strictness belongs.
func (rc *refactorContext) asyncReturnAdoptionEdits(fn *ast.Node) []*lsproto.TextEdit {
	body := fn.Body()
	var names []string
	var collect func(*ast.Node) bool
	collect = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			names = append(names, n.Text())
		}
		return n.ForEachChild(collect)
	}
	rc.file.AsNode().ForEachChild(collect)
	name := uniqueName("__asyncValue", names)
	text := rc.file.Text()
	outer := lineIndent(text, nodeStart(rc.file, fn))
	indent := outer + "  "
	end := body.End()
	suffix := "\n" + indent + "return try Effect.tryPromise(async () => " + name + ")\n" + outer + "}"
	if ast.IsBlock(body) {
		start := nodeStart(rc.file, body) + 1
		if statements := body.AsBlock().Statements; statements != nil {
			for _, statement := range statements.Nodes {
				if !ast.IsExpressionStatement(statement) || !ast.IsStringLiteral(statement.Expression()) {
					break
				}
				start = statement.End()
			}
		}
		prefix := "\n" + indent + "const " + name + " = try effect {"
		return []*lsproto.TextEdit{rc.textEdit(start, start, prefix), rc.textEdit(end, end, suffix)}
	}
	prefix := "{\n" + indent + "const " + name + " = try effect { return "
	return []*lsproto.TextEdit{rc.textEdit(nodeStart(rc.file, body), nodeStart(rc.file, body), prefix), rc.textEdit(end, end, " }"+suffix)}
}
