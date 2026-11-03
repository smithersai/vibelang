package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// VIP-6 supplies Effect exports as globals. Shorten only direct calls whose
// available bare binding is the very same export; reading the receiver must
// not execute code, and prefix comments must keep their source position.
func effectGlobalCallEdit(c *checker.Checker, file *ast.SourceFile, node *ast.Node) *sourceEdit {
	if !ast.IsPropertyAccessExpression(node) || !ast.IsIdentifier(node.Name()) ||
		ast.GetSourceFileOfNode(node) != file || node.QuestionDotToken() != nil || node.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 || inHatch(node) {
		return nil
	}
	call := node.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() != node || call.QuestionDotToken() != nil {
		return nil
	}
	name := node.Name().Text()
	if !isPreludeName(name) || implicitEffectModuleDisabled(c, file, name) ||
		!isNamespaceValue(c, node.Expression()) || !isEffectFunction(c, node, "Effect", name) {
		return nil
	}
	if options := optionsFor(c, file); options != nil && options.VibeLang != nil && options.VibeLang.EffectGlobals == core.TSFalse {
		return nil
	}
	bare := c.ResolveName(name, node.Name(), ast.SymbolFlagsValue, false)
	qualified := c.GetSymbolAtLocation(node.Name())
	if bare == nil || qualified == nil || aliasTarget(c, bare) != aliasTarget(c, qualified) {
		return nil
	}
	start, end := nodeStart(file, node), nodeStart(file, node.Name())
	receiverEnd := node.Expression().End()
	if start < 0 || receiverEnd < start || end < receiverEnd || node.End() < end || node.End() > len(file.Text()) ||
		file.Text()[end:node.End()] != name || strings.TrimSpace(file.Text()[receiverEnd:end]) != "." {
		return nil
	}
	prefix := file.Text()[start:end]
	if strings.Contains(prefix, "/*") || strings.Contains(prefix, "//") {
		return nil
	}
	return &sourceEdit{start, end, ""}
}
