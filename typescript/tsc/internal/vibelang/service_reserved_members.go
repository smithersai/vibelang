package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

var serviceReservedMemberDiagnostic = message(902, errorCategory, "A service key or defaultValue uses only static readonly, without optional or definite markers. Remove other modifiers and ? or !.")

// Key literal/readonly failures belong to EK0901, the first applicable row.
// This check supplies EK0902 for otherwise valid keys and DefaultMember syntax.
func serviceReservedMemberError(member *ast.Node) *Message {
	if !ast.IsPropertyDeclaration(member) || !ast.IsStatic(member) || member.Name() == nil ||
		!ast.IsIdentifier(member.Name()) {
		return nil
	}
	name := member.Name().Text()
	if name != "key" && name != "defaultValue" {
		return nil
	}
	if name == "key" && (!ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) || member.Initializer() == nil || !ast.IsStringLiteral(member.Initializer())) {
		return nil
	}
	if member.PostfixToken() != nil {
		return serviceReservedMemberDiagnostic
	}
	for _, modifier := range member.ModifierNodes() {
		if modifier.Flags&ast.NodeFlagsReparsed != 0 || modifier.Kind == ast.KindStaticKeyword || modifier.Kind == ast.KindReadonlyKeyword {
			continue
		}
		return serviceReservedMemberDiagnostic
	}
	if name == "defaultValue" {
		if !ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) {
			return serviceReservedMemberDiagnostic.With("A service defaultValue is static readonly. Add readonly.")
		}
		if member.Initializer() == nil {
			return serviceReservedMemberDiagnostic.With("A service defaultValue needs an initializer. Write a factory that returns its implementation.")
		}
	}
	return nil
}

func checkReservedServiceMembers(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) && declarationWord(node) == "service" && serviceShape(node) == nil {
			for _, member := range node.Members() {
				if message := serviceReservedMemberError(member); message != nil {
					report(c, member, message)
					cover(c, member)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func init() {
	registry[serviceReservedMemberDiagnostic.Code] = serviceReservedMemberDiagnostic
	fileChecks = append(fileChecks, checkReservedServiceMembers)
}
