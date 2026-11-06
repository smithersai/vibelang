package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// A union member need not become never after its tag's last case: TypeScript
// can retain a whole object whose _tag is itself a union, or a union whose
// members all share a tag. Chapter 004 counts each member/tag case separately.
func remainingPatternMembers(c *checker.Checker, call *ast.Node, left *checker.Type) *checker.Type {
	arms := parser.MatchMemberArms(call)
	if len(arms) == 0 || left == c.GetErrorType() {
		return left
	}
	var remaining []*checker.Type
	for _, member := range members(left) {
		// Primitive wrapper declarations can expose _tag, but object patterns
		// reject primitive values before reading any property.
		var tag *checker.Type
		if isFiniteMatchObjectType(member) {
			tag = c.GetTypeOfPropertyOfType(member, "_tag")
		}
		covered := tag != nil && isLiteralTagType(tag)
		if tag == nil && member.Flags()&checker.TypeFlagsUnit != 0 {
			for _, arm := range arms {
				if memberArmCovers(c, arm, member, nil) {
					covered = true
					break
				}
			}
			if covered {
				continue
			}
		}
		if covered && tag != nil {
			for _, tagCase := range members(tag) {
				found := false
				for _, arm := range arms {
					if memberArmCovers(c, arm, member, tagCase) {
						found = true
						break
					}
				}
				if !found {
					covered = false
					break
				}
			}
		}
		if !covered {
			remaining = append(remaining, member)
		}
	}
	return c.GetUnionType(remaining)
}

func memberArmCovers(c *checker.Checker, arm parser.MatchMemberArm, member, tag *checker.Type) bool {
	for _, alternative := range arm.Alternatives {
		if memberArmCovers(c, alternative, member, tag) {
			return true
		}
	}
	if arm.Value != nil {
		if instance := errorDeclarationInstance(c, arm.Value); instance != nil && tag != nil {
			expected := c.GetTypeOfPropertyOfType(instance, "_tag")
			return expected != nil && expected.Flags()&checker.TypeFlagsUnion == 0 && isLiteralTagType(expected) && c.IsTypeAssignableTo(tag, expected)
		}
		if tag == nil && !parser.IsSignedNumberZero(arm.Value) {
			expected := c.GetTypeAtLocation(arm.Value)
			return expected != nil && expected.Flags()&checker.TypeFlagsUnion == 0 && isLiteralTagType(expected) && c.IsTypeAssignableTo(member, expected)
		}
		return false
	}
	if tag == nil || len(arm.Tags) == 0 {
		return false
	}
	for _, name := range arm.Required {
		property := c.GetPropertyOfType(member, name)
		if property == nil || property.Flags()&ast.SymbolFlagsOptional != 0 {
			return false
		}
	}
	for _, literal := range arm.Tags {
		if parser.IsSignedNumberZero(literal) {
			return false
		}
		value := c.GetTypeAtLocation(literal)
		if value == nil || value.Flags()&checker.TypeFlagsUnion != 0 || !isLiteralTagType(value) || !c.IsTypeAssignableTo(tag, value) {
			return false
		}
	}
	return true
}
