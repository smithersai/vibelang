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
		if t != nil && checker.IsTypeUsableAsPropertyName(t) {
			return checker.GetPropertyNameFromType(t) == "_tag"
		}
		if key, known := keyDomainSingleString(c, t, 0); known {
			return key == "_tag"
		}
		return errorMemberKeyMayBeTag(c, member, t)
	}
	return errorMemberIsTag(member)
}

// errorMemberKeyMayBeTag reports whether a schema error's computed method or
// accessor key has a runtime domain that is not proved to exclude "_tag"
// (chapter 3 static rules, VIP-29). At runtime such a getter shadows the
// tag the schema constructor assigns, so construction throws. Instance
// fields keep their own rule; a plain error's own _tag shadows a prototype
// member.
func errorMemberKeyMayBeTag(c *checker.Checker, member *ast.Node, t *checker.Type) bool {
	if (ast.IsPropertyDeclaration(member) && !ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic)) || member.Parent == nil {
		return false
	}
	if form, _ := errorFormOf(member.Parent); form != errorFormSchemaRoot {
		return false
	}
	return keyDomainMayBeTag(c, t, 0)
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
		if restrictedEffectMember(member) {
			continue // VIP-1 owns forbidden Effect modifiers.
		}
		found = true
		if key := member.Name(); ast.IsComputedPropertyName(key) {
			if t := c.GetTypeAtLocation(key.Expression()); t != nil && !checker.IsTypeUsableAsPropertyName(t) {
				report(c, key, EK2117.With("This computed key has the type {0}, which may be \"_tag\", the name reserved for the error's generated tag. Use a key whose type excludes \"_tag\", such as a literal or a symbol, or write the explicit Effect TypeScript class to keep it."), c.TypeToString(t))
				coverCodes(c, key, 2416, 2425, 2564, 2610, 2611, 2612, 4114)
				continue
			}
		}
		report(c, member.Name(), EK2117.With("The member name _tag is reserved for the error's generated tag. Rename the member, or write the explicit Effect TypeScript class to keep it."))
		coverCodes(c, member.Name(), 2416, 2425, 2564, 2610, 2611, 2612, 4114)
	}
	if found {
		// A private or protected _tag makes the generated class incorrectly
		// extend its base; that is the same member's error, at the name.
		coverCodes(c, class.Name(), 2415)
	}
	return found
}
