package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() {
	fileChecks = append(fileChecks, checkEffectBodyless)
	tsFormRules[EK0108.Code] = &tsFormRule{
		message: EK0108,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}

// A missing body alone is not forbidden: nonambient overload signatures
// retain their native meaning. Inherited ambientness and abstract members
// are rejected independently of whether the checker lowers their bodies.
func forbiddenEffectDeclaration(node *ast.Node) bool {
	if !isMarkedEffect(node) {
		return false
	}
	if node.Flags&ast.NodeFlagsAmbient != 0 {
		return true
	}
	// Service contracts receive an abstract modifier during parsing. Only a
	// written abstract declaration belongs to the Functions placement rule.
	for _, modifier := range node.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
			return true
		}
	}
	return node.Parent != nil && (node.Parent.Kind == ast.KindInterfaceDeclaration || node.Parent.Kind == ast.KindTypeLiteral)
}

func checkEffectBodyless(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if forbiddenEffectDeclaration(node) {
			reportAt(c, file, tsFormSpan(file, node), EK0108)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
