package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// yieldBodyFunction finds the source activation, excluding evaluated names
// and formal initialization. Compiler do/item arrows do not own source yield.
func yieldBodyFunction(file *ast.SourceFile, yield *ast.Node) *ast.Node {
	for node, child := yield.Parent, yield; node != nil; child, node = node, node.Parent {
		if node.Kind == ast.KindParameter && node.Parent != nil && ast.IsFunctionLike(node.Parent) {
			return nil
		}
		if node.Kind == ast.KindClassStaticBlockDeclaration || node.Kind == ast.KindPropertyDeclaration && child == node.Initializer() {
			return nil
		}
		if !ast.IsFunctionLike(node) || child != node.Body() {
			continue
		}
		if isDoArrow(file, node) || node.Kind == ast.KindArrowFunction && node.Flags&ast.NodeFlagsVibeLang != 0 && fiberHelper(node.Parent) == "$forConcurrent" {
			continue
		}
		return node
	}
	return nil
}

func init() { fileChecks = append(fileChecks, checkProducerDelegation) }

// VIP-21/detail50 specifies no producer delegation. Native generators keep
// their own protocol; errors inside an operand keep their native identities.
func checkProducerDelegation(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindYieldExpression && node.AsYieldExpression().AsteriskToken != nil {
			if fn := yieldBodyFunction(file, node); fn != nil && fn.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				flags := ast.GetFunctionFlags(fn)
				if flags&ast.FunctionFlagsGenerator != 0 && flags&ast.FunctionFlagsAsync == 0 {
					report(c, node, EK2103)
					coverCodes(c, node, 1163, 2488, 2504, 2766)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
