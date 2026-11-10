package vibelang

import (
	"sort"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Diagnostic coverage never feeds matchRemainder or provenExhaustive:
// reporting a missing case must not change inference, narrowing or emitted tests.
func checkLiteralDiscriminantMatch(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	captured := capturedSubject(c, call.Arguments()[0])
	if captured == nil {
		return
	}
	domain := c.GetTypeAtLocation(captured)
	if constraint := c.GetBaseConstraintOfType(domain); constraint != nil {
		domain = constraint
	}
	if domain == nil || domain == c.GetErrorType() {
		return
	}
	var arms []parser.MatchMemberArm
	for _, arm := range parser.MatchMemberArms(call) {
		if arm.Advisory != nil {
			arms = append(arms, *arm.Advisory)
		}
	}
	_, nativeLeft := matchSubjectTypes(c, call)
	if nativeLeft == c.GetErrorType() {
		return
	}
	cases, ok, _ := literalMatchCases(c, domain, arms, 0)
	if !ok {
		return
	}
	var left []*checker.Type
	for _, candidate := range cases {
		covered := finiteLiteralCaseCovered(c, call, candidate.typ)
		for _, arm := range arms {
			if literalArmCovers(c, arm, candidate) {
				covered = true
				break
			}
		}
		if !covered {
			left = append(left, candidate.typ)
		}
	}
	if len(left) == 0 {
		return
	}
	d := reportAt(c, file, call.Expression().Loc, EK4701, diagnosticUnionText(c, domain, call), diagnosticUnionText(c, c.GetUnionType(left), call))
	note(d, "Add an arm for each case that is left, or a default arm. Runtime matching is unchanged.")
}

type literalMatchCase struct {
	typ    *checker.Type
	fields map[string]*literalMatchCase
	absent bool
}

// Enumerate only finite fields mentioned by patterns. Untested payloads stay
// opaque. The bounded product avoids multiplying a large nested domain.
func literalMatchCases(c *checker.Checker, domain *checker.Type, arms []parser.MatchMemberArm, depth int) ([]*literalMatchCase, bool, bool) {
	if depth > 8 {
		return nil, false, true
	}
	properties := map[string][]parser.MatchMemberArm{}
	var collect func(parser.MatchMemberArm)
	collect = func(arm parser.MatchMemberArm) {
		for _, alt := range arm.Alternatives {
			collect(alt)
		}
		for _, prop := range arm.Properties {
			if name, ok := literalPatternKey(c, prop); ok && prop.Pattern != nil {
				properties[name] = append(properties[name], *prop.Pattern)
			}
		}
	}
	for _, arm := range arms {
		collect(arm)
	}
	keys := make([]string, 0, len(properties))
	for name := range properties {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	var out []*literalMatchCase
	for _, member := range members(domain) {
		if member.Flags()&checker.TypeFlagsNever != 0 {
			continue
		}
		if isLiteralTagType(member) {
			out = append(out, &literalMatchCase{typ: member})
			continue
		}
		if !isFiniteMatchObjectType(member) {
			return nil, false, false
		}
		// A member is finite through a field its patterns test (below) or
		// through a required literal field. An optional literal field that
		// no arm reads, such as the optional boolean Effect adds to the
		// global Error, is absent from most values and discriminates nothing.
		finite := false
		for _, prop := range c.GetPropertiesOfType(member) {
			if prop.Flags()&ast.SymbolFlagsOptional == 0 && isLiteralTagType(c.GetTypeOfPropertyOfType(member, prop.Name())) {
				finite = true
				break
			}
		}
		product := []*literalMatchCase{{typ: member, fields: map[string]*literalMatchCase{}}}
		for _, name := range keys {
			field := c.GetPropertyOfType(member, name)
			if field == nil {
				continue
			}
			typ := c.GetTypeOfPropertyOfType(member, name)
			choices, closed, exhausted := literalMatchCases(c, typ, properties[name], depth+1)
			if exhausted {
				return nil, false, true
			}
			if closed {
				finite = true
			} else {
				choices = []*literalMatchCase{{typ: typ}}
			}
			if field.Flags()&ast.SymbolFlagsOptional != 0 {
				choices = append(choices, &literalMatchCase{typ: typ, absent: true})
			}
			if len(choices)*len(product) > 256 {
				return nil, false, true
			}
			var next []*literalMatchCase
			for _, parent := range product {
				for _, value := range choices {
					fields := make(map[string]*literalMatchCase, len(parent.fields)+1)
					for key, previous := range parent.fields {
						fields[key] = previous
					}
					fields[name] = value
					refined := parent.typ
					if !value.absent && closed && typ != value.typ && field.Flags()&ast.SymbolFlagsOptional == 0 {
						refined = c.GetIntersectionType([]*checker.Type{refined, c.NewReadonlyPropertyType(name, value.typ)})
					}
					next = append(next, &literalMatchCase{typ: refined, fields: fields})
				}
			}
			product = next
		}
		if !finite {
			return nil, false, false
		}
		out = append(out, product...)
	}
	return out, true, false
}

func literalPatternKey(c *checker.Checker, property parser.MatchMemberProperty) (string, bool) {
	if !property.Computed {
		return property.Key.Text(), true
	}
	key := c.GetTypeAtLocation(property.Key)
	if constraint := c.GetBaseConstraintOfType(key); constraint != nil {
		key = constraint
	}
	if key == nil || !checker.IsTypeUsableAsPropertyName(key) {
		return "", false
	}
	return checker.GetPropertyNameFromType(key), true
}

func literalArmCovers(c *checker.Checker, arm parser.MatchMemberArm, candidate *literalMatchCase) bool {
	if arm.Irrefutable {
		return true
	}
	for _, alt := range arm.Alternatives {
		if literalArmCovers(c, alt, candidate) {
			return true
		}
	}
	if arm.Value != nil {
		if parser.IsSignedNumberZero(arm.Value) {
			return false
		}
		value := c.GetTypeAtLocation(arm.Value)
		if instance := classPatternInstance(c, arm.Value); instance != nil {
			return c.IsTypeAssignableTo(candidate.typ, instance)
		}
		return value != nil && value.Flags()&checker.TypeFlagsUnion == 0 && isLiteralTagType(value) && c.IsTypeAssignableTo(candidate.typ, value)
	}
	if len(arm.Properties) == 0 || !isFiniteMatchObjectType(candidate.typ) {
		return false
	}
	for _, prop := range arm.Properties {
		name, ok := literalPatternKey(c, prop)
		if !ok || prop.Pattern == nil {
			return false
		}
		value := candidate.fields[name]
		if value == nil {
			field := c.GetPropertyOfType(candidate.typ, name)
			if field == nil || field.Flags()&ast.SymbolFlagsOptional != 0 {
				return false
			}
			value = &literalMatchCase{typ: c.GetTypeOfPropertyOfType(candidate.typ, name)}
		}
		if value.absent || !literalArmCovers(c, *prop.Pattern, value) {
			return false
		}
	}
	return true
}

// Keep the existing finite-case patterns (errors, Option, Exit and Result)
// when they occur beside an object with another literal discriminant. Replay
// only the match tests on this already-finite member; this is advisory and
// never enters the proof consumed by lowering.
func finiteLiteralCaseCovered(c *checker.Checker, call *ast.Node, domain *checker.Type) bool {
	if !isFiniteMatchType(c, domain) {
		return false
	}
	statement := call.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return false
	}
	left := domain
	for _, arm := range statement.Parent.Statements() {
		if arm == statement {
			break
		}
		if ast.IsBlock(arm) {
			left = genericArmRemainder(c, call.Arguments()[0], left, arm)
		}
		if left == c.GetErrorType() {
			return false
		}
	}
	return left.Flags()&checker.TypeFlagsNever != 0
}

// classPatternInstance returns the instance type a class pattern such as
// when Error: tests with instanceof, or nil for any other value pattern and
// for a class that declares its own custom matcher.
func classPatternInstance(c *checker.Checker, matcher *ast.Node) *checker.Type {
	constructor := c.GetTypeAtLocation(matcher)
	if constructor == nil || isLiteralTagType(constructor) {
		return nil
	}
	if name := customMatcherPropertyName(c); name != "" && c.GetPropertyOfType(constructor, name) != nil {
		return nil
	}
	signatures := c.GetSignaturesOfType(constructor, checker.SignatureKindConstruct)
	if len(signatures) == 0 {
		return nil
	}
	return c.GetReturnTypeOfSignature(c.GetErasedSignature(signatures[len(signatures)-1]))
}
