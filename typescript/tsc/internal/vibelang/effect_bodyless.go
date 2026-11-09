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
	seen := map[int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if forbiddenEffectDeclaration(node) {
			span := tsFormSpan(file, node)
			reportAt(c, file, span, EK0108)
			seen[span.Pos()] = true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	// A schema maps its fields to codecs, which erases their type members:
	// read the modifier from the source of each field.
	for _, repair := range schemaTypeMemberRepairs(file) {
		if repair.effect && !seen[repair.primary.Pos()] {
			seen[repair.primary.Pos()] = true
			reportAt(c, file, repair.primary, EK0108)
		}
	}
}
