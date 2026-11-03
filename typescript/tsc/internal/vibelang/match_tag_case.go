package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Chapter 4, Coverage: an object pattern with _tag: "V" covers case V of
// each tagged member, and "Members that share a tag are covered one at a
// time, and one left uncovered stays uncovered." Coverage is per member and
// tag case, even where TypeScript does not narrow: it narrows an object by
// _tag only when _tag is a discriminant of a union, and it keeps a member
// whose _tag is a union of literals whole when a test excludes one of them.
//
// So where a test the parser wrote, $match1._tag === "V", or $is(V, $match1._tag)
// for an enum member or unique symbol V, is false, a member
// whose _tag is only V is gone, and a member whose _tag can be V keeps only
// its other tag cases:
//
//	{ _tag: "A"; x: number } | { _tag: "A"; y: number }  after "A": never
//	{ _tag: "A" | "B"; x: number }                       after "A": { _tag: "A" | "B"; x: number } & { readonly _tag: "B" }
//
// A true test is left to TypeScript, so the body of an arm sees the types
// it would see in a switch clause.
func init() { checker.RegisterFlowNarrowingHook(narrowTagCase) }

func narrowTagCase(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, _ func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if assumeTrue {
		return nil
	}
	access, operand := tagCaseTest(test)
	if access == nil || !ast.IsPropertyAccessExpression(access) || access.Name().Text() != "_tag" || !c.IsMatchingReference(reference, access.Expression()) {
		return nil
	}
	value := c.GetTypeAtLocation(operand)
	if value == nil || value.Flags()&checker.TypeFlagsUnit == 0 {
		return nil
	}
	members := []*checker.Type{t}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		members = t.Types()
	}
	changed := false
	kept := make([]*checker.Type, 0, len(members))
	for _, member := range members {
		if member.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 || c.GetPropertyOfType(member, "_tag") == nil {
			kept = append(kept, member)
			continue
		}
		tag := c.GetTypeOfPropertyOfType(member, "_tag")
		if tag == nil || !isLiteralTagType(tag) {
			kept = append(kept, member)
			continue
		}
		rest := c.FilterType(tag, func(m *checker.Type) bool { return !sameUnitType(c, m, value) })
		switch {
		case rest == tag:
			kept = append(kept, member)
		case rest.Flags()&checker.TypeFlagsNever != 0:
			changed = true
		default:
			changed = true
			kept = append(kept, c.GetIntersectionType([]*checker.Type{member, c.NewReadonlyPropertyType("_tag", rest)}))
		}
	}
	if !changed {
		return nil
	}
	return c.GetUnionType(kept)
}

// sameUnitType reports whether a and b, unit types, are the same value, a
// fresh literal and its regular type included.
func sameUnitType(c *checker.Checker, a, b *checker.Type) bool {
	return a.Flags()&checker.TypeFlagsUnit != 0 && c.IsTypeAssignableTo(a, b) && c.IsTypeAssignableTo(b, a)
}

// tagCaseTest returns the _tag read and the tested value of test when the
// parser wrote it for a tag case: $match1._tag === V for a literal, or
// $is(V, $match1._tag) for a name or a dotted name, which tests SameValue
// when V is neither an object nor a function, as a unit type is not.
func tagCaseTest(test *ast.Node) (access, value *ast.Node) {
	switch {
	case ast.IsBinaryExpression(test):
		binary := test.AsBinaryExpression()
		if binary.OperatorToken.Kind != ast.KindEqualsEqualsEqualsToken || binary.OperatorToken.Flags&ast.NodeFlagsReparsed == 0 {
			return nil, nil
		}
		return ast.SkipParentheses(binary.Left), binary.Right
	case isPatternCall(test, "$is") && len(test.Arguments()) == 2:
		return ast.SkipParentheses(test.Arguments()[1]), test.Arguments()[0]
	}
	return nil, nil
}
