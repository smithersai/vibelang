package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK4831 (D285): a Context.Service class, which a service declaration
// (D128, D223) writes without the key, the Self parameter, and the shape's
// separate type:
//
//	class Users extends Context.Service<Users, { find(id: string): Effect.Effect<User, NotFound> }>()("app/Users") {}
//	service Users { find(id: string): User!NotFound }
func init() {
	tsFormRules[EK4831.Code] = &tsFormRule{
		message: EK4831,
		find:    findServiceClasses,
	}
}

// serviceClassOf returns the key argument and the shape type argument of
// class when it extends Context.Service<Self, Shape>()(key) with Self the
// class itself, or nil and nil.
func serviceClassOf(c *checker.Checker, class *ast.Node) (key *ast.Node, shape *ast.Node) {
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil || class.Name() == nil {
		return nil, nil
	}
	outer := extends.Expression()
	if !ast.IsCallExpression(outer) || len(outer.Arguments()) != 1 {
		return nil, nil
	}
	inner := outer.Expression()
	if !ast.IsCallExpression(inner) || len(inner.Arguments()) != 0 || !isEffectFunction(c, inner.Expression(), "Context", "Service") {
		return nil, nil
	}
	arguments := inner.TypeArguments()
	if len(arguments) != 2 || !ast.IsTypeReferenceNode(arguments[0]) || arguments[0].TypeArguments() != nil {
		return nil, nil
	}
	if self := arguments[0].AsTypeReferenceNode().TypeName; !ast.IsIdentifier(self) || self.Text() != class.Name().Text() {
		return nil, nil
	}
	return outer.Arguments()[0], arguments[1]
}

// findServiceClasses reports EK4831 at each Context.Service class of file
// that a service declaration could write.
func findServiceClasses(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) && !inHatch(node) {
			if isServiceClassForm(c, node) {
				report(node.Name(), nil, node.Name().Text())
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isServiceClassForm identifies Context.Service classes described by the warning.
func isServiceClassForm(c *checker.Checker, class *ast.Node) bool {
	_, shape := serviceClassOf(c, class)
	if shape == nil || class.TypeParameters() != nil || len(ast.GetImplementsHeritageClauseElements(class)) != 0 {
		return false
	}
	for _, modifier := range class.ModifierNodes() {
		if modifier.Kind != ast.KindExportKeyword {
			return false
		}
	}
	for _, member := range class.Members() {
		if ast.IsSemicolonClassElement(member) {
			continue
		}
		if !ast.IsStatic(member) || ast.IsPropertyDeclaration(member) && member.Name() != nil && member.Name().Text() == "default" {
			return false
		}
	}
	shapeType := c.GetTypeFromTypeNode(shape)
	return shapeType != nil && (!ast.IsTypeLiteralNode(shape) ||
		shapeType.Flags()&checker.TypeFlagsObject != 0 && len(c.GetSignaturesOfType(shapeType, checker.SignatureKindCall)) == 0 && len(c.GetPropertiesOfType(shapeType)) != 0)
}

func isBangType(node *ast.Node) bool {
	return ast.IsTypeReferenceNode(node) && node.AsTypeReferenceNode().TypeName.Flags&ast.NodeFlagsReparsed != 0
}
