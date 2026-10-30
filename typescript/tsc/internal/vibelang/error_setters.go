package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var ek1302Setter = EK1302.With("An error declaration cannot contain a setter. Write a method instead, or use the quick fix to keep the setter in an Effect TypeScript class.")

func init() {
	fileChecks = append(fileChecks, checkErrorSetters)
}

func checkErrorSetters(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			for _, member := range node.Members() {
				if member.Flags&ast.NodeFlagsReparsed == 0 && ast.IsSetAccessorDeclaration(member) && !ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) && !errorMemberIsTag(member) {
					report(c, member, ek1302Setter)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
