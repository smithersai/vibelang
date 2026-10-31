package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Service members become a named object type (VIP-9, detail 181), so their
// source class must not lend a polymorphic instance type to a written this.
func checkServiceShapeThisTypes(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindThisType {
			member := ast.GetThisContainer(node, false, false)
			if isServiceShapeThisMember(member) {
				d := c.AddDiagnostic(ast.NewDiagnostic(file, scanner.GetErrorRangeForNode(file, node), diagnostics.A_this_type_is_available_only_in_a_non_static_member_of_a_class_or_interface))
				note(d, "A service's members form an object type. Name the implementation type, or declare a separate interface for polymorphic this.")
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func isServiceShapeThisMember(member *ast.Node) bool {
	if member == nil || (!ast.IsPropertyDeclaration(member) && !ast.IsMethodDeclaration(member)) ||
		ast.IsStatic(member) ||
		member.Parent == nil || !ast.IsClassLike(member.Parent) ||
		declarationWord(member.Parent) != "service" || serviceShape(member.Parent) != nil {
		return false
	}
	if ast.IsPropertyDeclaration(member) {
		if member.Initializer() != nil {
			return false
		}
	} else if member.Body() != nil {
		return false
	}
	if member.Name() == nil || ast.IsPrivateIdentifier(member.Name()) {
		return false
	}
	if token := member.PostfixToken(); token != nil && token.Kind != ast.KindQuestionToken {
		return false
	}
	if ast.IsMethodDeclaration(member) {
		if member.AsMethodDeclaration().AsteriskToken != nil {
			return false
		}
		// A bare new(...) head is a rejected construct signature, not a
		// MethodSignature. Quoted/computed/optional method names stay members.
		if member.PostfixToken() == nil && ast.IsIdentifier(member.Name()) && member.Name().Text() == "new" {
			return false
		}
	}
	for _, modifier := range member.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
			continue
		}
		if ast.IsPropertyDeclaration(member) && modifier.Kind == ast.KindReadonlyKeyword {
			continue
		}
		return false
	}
	return true
}

func init() { fileChecks = append(fileChecks, checkServiceShapeThisTypes) }
