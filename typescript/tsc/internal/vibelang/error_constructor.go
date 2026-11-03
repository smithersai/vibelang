package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK1301 (VIP-13, VIP-29; chapter 3 static rules, first row): a constructor
// in an error or schema error body. The declaration's constructor takes its
// fields; a written one gets this one diagnostic, and TypeScript's errors
// inside it are dropped (error_rejected_members.go). EK4814, the Schema-class
// constructor warning, yields to it (lsrules.go).
var EK1301 = message(1301, errorCategory, "An error declaration cannot have a constructor: its fields are the constructor's one argument.")

func init() {
	registry[EK1301.Code] = EK1301
	fileChecks = append(fileChecks, checkErrorConstructors)
	tsFormFixCodes = append(tsFormFixCodes, EK1301.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1301.Code)
	provider := *errorMemberClassFix
	provider.ErrorCodes = []int32{EK1301.Code}
	ls.RegisterCodeFixProvider(&provider)
}

func checkErrorConstructors(c *checker.Checker, file *ast.SourceFile) {
	for _, member := range errorConstructors(file) {
		if restrictedEffectMember(member) {
			continue
		}
		d := report(c, member, EK1301)
		note(d, "Keep the constructor in an Effect TypeScript class: the quick fix rewrites the declaration as one.")
	}
}

// errorConstructors lists the written constructors of every error declaration in file.
func errorConstructors(file *ast.SourceFile) []*ast.Node {
	var found []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if errorDeclarationBase(node) {
			for _, member := range node.Members() {
				if member.Kind == ast.KindConstructor && member.Flags&ast.NodeFlagsReparsed == 0 {
					found = append(found, member)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}
