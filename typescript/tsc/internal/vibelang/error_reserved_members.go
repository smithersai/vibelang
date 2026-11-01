package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Payload fields have their own projection checks. These are actual class
// members, whose names keep native computed-name evaluation.
func errorMemberIsReservedTag(c *checker.Checker, member *ast.Node) bool {
	name := member.Name()
	if name == nil || ast.IsPrivateIdentifier(name) {
		return false
	}
	if ast.IsComputedPropertyName(name) {
		t := c.GetTypeAtLocation(name.Expression())
		return t != nil && checker.IsTypeUsableAsPropertyName(t) && checker.GetPropertyNameFromType(t) == "_tag"
	}
	return errorMemberIsTag(member)
}

// Return whether the legacy tag-type check has been superseded for this root.
// The diagnostic explains only the rejected member's name and override shape;
// independent errors inside its body remain visible.
func checkErrorReservedMembers(c *checker.Checker, class *ast.Node) bool {
	found := false
	for _, member := range class.Members() {
		if member.Flags&ast.NodeFlagsReparsed != 0 || !errorMemberIsReservedTag(c, member) {
			continue
		}
		if isMarkedEffect(member) && (ast.IsGetAccessorDeclaration(member) || ast.IsSetAccessorDeclaration(member) || ast.IsConstructorDeclaration(member)) {
			continue // VIP-1 owns forbidden Effect modifiers.
		}
		found = true
		report(c, member.Name(), EK2117.With("The member name _tag is reserved for the error's generated tag. Rename the member, or write the explicit Effect TypeScript class to keep it."))
		coverCodes(c, member.Name(), 2416, 2425, 2610, 2611, 4114)
	}
	return found
}
