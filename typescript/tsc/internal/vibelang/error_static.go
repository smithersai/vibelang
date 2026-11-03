package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-13 also applies to schema errors (VIP-29): no user-written static
// members. The custom matcher and schema registration are compiler supplied.
var EK1302 = message(1302, errorCategory, "An error declaration cannot contain a static member. Move it outside the declaration, or write the error as a TypeScript class.")

func init() {
	registry[EK1302.Code] = EK1302
	fileChecks = append(fileChecks, checkErrorStaticMembers)
}

func checkErrorStaticMembers(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			for _, member := range node.Members() {
				if errorMemberIsReservedTag(c, member) || restrictedEffectMember(member) {
					continue
				}
				if member.Flags&ast.NodeFlagsReparsed == 0 && (ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) || member.Kind == ast.KindClassStaticBlockDeclaration) {
					report(c, member, EK1302)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// Recognize only bases synthesized for declarations, never a handwritten
// Data.TaggedError or Schema.TaggedError class.
func errorDeclarationBase(node *ast.Node) bool {
	if !ast.IsClassDeclaration(node) {
		return false
	}
	base := ast.GetClassExtendsHeritageElement(node)
	if base == nil || !ast.IsCallExpression(base.Expression()) {
		return false
	}
	callee := base.Expression().Expression()
	if isSynthesizedName(callee, "TaggedError") {
		return true
	}
	return ast.IsCallExpression(callee) && ast.IsPropertyAccessExpression(callee.Expression()) && isSynthesizedName(callee.Expression().Name(), "TaggedError") && isSynthesizedName(callee.Expression().Expression(), "Schema")
}

func errorMemberIsTag(member *ast.Node) bool {
	name := member.Name()
	return name != nil && (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) && name.Text() == "_tag"
}
