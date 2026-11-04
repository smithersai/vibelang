package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Chapter 004, Class patterns (decided details 94 and 100): after own matchers,
// fixed patterns, built-ins and declaration diagnostics, dispatch uses the
// callee's static signatures. A construct signature selects instanceof, and an
// extractor on such a class is EK0704 (match_ordinary_extractor.go). Call signatures only select
// C(subject, { matchType }): a bare pattern needs a return type assignable to
// boolean and an extractor one assignable to Iterable<unknown> | false. Other
// return types, and a callee with neither signature, are EK0702. A primitive
// value matches by SameValue and takes no dispatch.

var (
	ek0702Neither   = EK0702.With("{0} has no call or construct signature, so it cannot be a class pattern: test the value in a guard, when let value and if (…).")
	ek0702Bare      = EK0702.With("{0} returns {1}, not a boolean, so it cannot be a class pattern: test the call in a guard, when let value and if ({0}(value) === …).")
	ek0702Extractor = EK0702.With("{0} returns {1}, not an iterable or false, so it cannot be an extractor: test the call in a guard, when let value and if (…).")
	ek0107Pattern   = EK0107.With("The global Function is not available in a .vibe file: test the value with a typeof guard, when let f and if (typeof f === \"function\").")
)

// checkClassPatternDispatch checks matcher, the expression of a class pattern
// that no earlier diagnostic took, against the rule above.
func checkClassPatternDispatch(c *checker.Checker, matcher *ast.Node, extractor bool) {
	if matcher == nil || !(ast.IsIdentifier(matcher) || ast.IsPropertyAccessExpression(matcher) || ast.IsElementAccessExpression(matcher)) {
		return
	}
	name := scanner.GetTextOfNode(matcher)
	if ast.IsIdentifier(matcher) && matcher.Text() == "Function" {
		if symbol := c.GetSymbolAtLocation(matcher); symbol != nil && isGlobal(c, symbol) {
			report(c, matcher, ek0107Pattern)
			cover(c, matcher)
		}
		return
	}
	if _, known := extractedLength(c, matcher); known {
		return // an error declaration or a fixed pattern, whose matcher is known
	}
	if _, fixed := builtinMatcherOf(c, matcher); fixed || isRetainedErrorMatcher(c, matcher) {
		return
	}
	if _, _, variant := dataVariantOf(c, matcher); variant || serviceNamedBy(c, matcher) != nil {
		return // their own diagnostics and forms
	}
	t := c.TypeOfPatternMatcher(matcher)
	if t == nil || c.GetSymbolAtLocation(matcher) == nil {
		return // an unresolved name, which its own diagnostic reports
	}
	if t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		report(c, matcher, ek0702Neither, name)
		cover(c, matcher)
		return
	}
	if !isObjectLikeMatcher(t) || hasOwnPatternMatcher(c, t) {
		return
	}
	// VIP-7 admits stored RegExp values as well as regex literals.
	// Their emulated matcher needs no call or construct signature.
	if regexp := c.GetGlobalRegExpType(); regexp != nil && regexp.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) == 0 && c.IsTypeAssignableTo(t, regexp) {
		return
	}
	if len(c.GetConstructSignatures(t)) > 0 {
		return
	}
	calls := c.GetCallSignatures(t)
	if len(calls) == 0 {
		report(c, matcher, ek0702Neither, name)
		cover(c, matcher)
		return
	}
	for _, signature := range calls {
		returned := c.GetReturnTypeOfSignature(signature)
		if returned == nil || returned.Flags()&checker.TypeFlagsAny != 0 {
			continue
		}
		if extractor && !isExtractorResult(c, returned) {
			report(c, matcher, ek0702Extractor, name, c.TypeToString(returned))
			cover(c, matcher)
			return
		}
		if !extractor && !c.IsTypeAssignableTo(returned, c.GetBooleanType()) {
			report(c, matcher, ek0702Bare, name, c.TypeToString(returned))
			cover(c, matcher)
			return
		}
	}
}

// isObjectLikeMatcher reports whether t is an object type, not a primitive
// value or a union holding one.
func isObjectLikeMatcher(t *checker.Type) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isObjectLikeMatcher(member) {
				return false
			}
		}
		return true
	}
	return t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) != 0
}

// hasOwnPatternMatcher reports whether t, a class's static side or an object,
// has its own customMatcher property. A static matcher inherited from a
// superclass is not its own (decided details 67 and 93).
func hasOwnPatternMatcher(c *checker.Checker, t *checker.Type) bool {
	if hasRegisteredSchemaErrorMatcher(c, t) {
		return true
	}
	symbol := t.Symbol()
	var class *ast.Node
	if symbol != nil && symbol.ValueDeclaration() != nil && ast.IsClassLike(symbol.ValueDeclaration()) {
		class = symbol.ValueDeclaration()
	}
	property := ""
	if name := customMatcherPropertyName(c); name != "" {
		property = name
	}
	for _, candidate := range c.GetPropertiesOfType(t) {
		for _, declaration := range candidate.Declarations() {
			if class != nil && declaration.Parent != class {
				continue
			}
			if property != "" && candidate.Name() == property {
				return true
			}
			if name := declaration.Name(); name != nil && ast.IsComputedPropertyName(name) {
				switch entityText(name.Expression()) {
				case "customMatcher", "Symbol.customMatcher":
					return true
				}
			}
		}
	}
	return false
}

// isExtractorResult reports whether t is assignable to Iterable<unknown> | false.
func isExtractorResult(c *checker.Checker, t *checker.Type) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isExtractorResult(c, member) {
				return false
			}
		}
		return true
	}
	if t.Flags()&checker.TypeFlagsBooleanLiteral != 0 {
		return c.TypeToString(t) == "false"
	}
	return c.GetPropertyOfType(c.GetApparentType(t), c.GetPropertyNameForKnownSymbolName("iterator")) != nil
}
