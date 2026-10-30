package vibelang

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Built-in matchers (D213). The parser writes `when String:` and
// `when Option.None:` as $is(String, subject) and $is(Option.None, subject),
// as it writes every variable pattern (parser.BuiltinMatchers). A matcher is
// the built-in one only when it resolves to it: String to the global String,
// Option to effect's Option module. Then the checker narrows the subject as
// typeof or the module's guard does, and the lowering writes that test; a
// parameter named String is a variable pattern, and a data type named Option
// has its own variants:
//
//	when String:         typeof $match1 === "string"
//	when Option.None:    Option.isNone($match1)
//
// effect's Option module exports no value named None, so in a pattern's $is
// call Option.None reads the guard that tests it, Option.isNone.

func init() {
	checker.RegisterMissingPropertyHook(builtinVariantProperty)
	checker.RegisterFlowNarrowingHook(narrowBuiltinPattern)
	fileChecks = append(fileChecks, checkBuiltinPatterns)
	checker.RegisterCallExpressionTypeHook(builtinExtractionType)
	checker.RegisterFlowNarrowingHook(narrowBuiltinExtraction)
}

// checkBuiltinPatterns covers the checker's errors at the tests the parser
// writes for an extractor's arity.
func checkBuiltinPatterns(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		// An extractor's arity check deliberately permits a non-match,
		// including when its tuple length is known statically.
		if ast.IsBinaryExpression(node) {
			left := node.AsBinaryExpression().Left
			if ast.IsPropertyAccessExpression(left) && left.Name().Text() == "length" {
				if call := extractionCall(c, left.Expression()); call != nil {
					coverCodes(c, node, 2367)
				}
			}
		}
		if ast.IsElementAccessExpression(node) && extractionCall(c, node.Expression()) != nil {
			// Extra extractor arguments are unreachable after the arity test.
			// The parser's indexed reads must not leak tuple-bound errors.
			coverCodes(c, node, 2493)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// fixedErrorGuards is the settled Effect tagged-error inventory (detail 53).
// Resolve the namespace before consulting this table: aliases work and local
// objects with the same spelling retain their own matcher.
var fixedErrorGuards = map[string]map[string]string{
	"Cause": {
		"NoSuchElementError":    "isNoSuchElementError",
		"TimeoutError":          "isTimeoutError",
		"IllegalArgumentError":  "isIllegalArgumentError",
		"ExceededCapacityError": "isExceededCapacityError",
		"AsyncFiberError":       "isAsyncFiberError",
		"UnknownError":          "isUnknownError",
	},
	"Schema":        {"SchemaError": "isSchemaError"},
	"Cron":          {"CronParseError": "isCronParseError"},
	"PlatformError": {"PlatformError": "isPlatformError"},
	"SemVer":        {"SemVerError": "isSemVerError"},
	"Terminal":      {"QuitError": "isQuitError"},
	"TextDiff":      {"TextDiffError": "isTextDiffError"},
}

// builtinMatcherOf returns the built-in matcher that matcher, a pattern's
// matcher, resolves to, or false: the class of a primitive when matcher
// resolves to the global String, Number, Boolean, BigInt or Symbol, and a
// variant of effect's Option, Exit or Result when matcher is Module.Variant
// and Module resolves to that module.
func builtinMatcherOf(c *checker.Checker, matcher *ast.Node) (parser.BuiltinMatcher, bool) {
	if ast.IsPropertyAccessExpression(matcher) {
		module := effectModuleNamed(c, matcher.Expression())
		if guard := fixedErrorGuards[module][matcher.Name().Text()]; guard != "" {
			return parser.BuiltinMatcher{Module: module, Guard: guard, Values: []string{""}}, true
		}
		builtin, ok := parser.BuiltinMatchers[module+"."+matcher.Name().Text()]
		if ok && module != "" {
			return builtin, true
		}
	}
	builtin, ok := parser.BuiltinMatcherNamed(matcher)
	if !ok || builtin.TypeOf == "" {
		return parser.BuiltinMatcher{}, false
	}
	if symbol := c.GetSymbolAtLocation(matcher); symbol == nil || symbol != c.GlobalSymbol(matcher.Text(), ast.SymbolFlagsValue) {
		return parser.BuiltinMatcher{}, false
	}
	return builtin, true
}

// effectModuleNamed returns the name of effect's module that expression
// resolves to, among the modules whose variants are built-in matchers, or "".
func effectModuleNamed(c *checker.Checker, expression *ast.Node) string {
	symbol := c.GetSymbolAtLocation(expression)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsValueModule == 0 {
		return ""
	}
	for _, declaration := range symbol.Declarations() {
		for _, module := range []string{"Option", "Exit", "Result", "Cause", "Schema", "Cron", "PlatformError", "SemVer", "Terminal", "TextDiff"} {
			if isEffectModuleFile(ast.GetSourceFileOfNode(declaration), module) {
				return module
			}
		}
	}
	return ""
}

// isBuiltinPatternTest reports whether node is a pattern's $is call whose
// matcher resolves to a built-in matcher.
func isBuiltinPatternTest(c *checker.Checker, node *ast.Node) bool {
	if !isPatternCall(node, "$is") {
		return false
	}
	_, ok := builtinMatcherOf(c, node.Arguments()[0])
	return ok
}

// builtinVariantProperty is the checker's missing property hook. In a
// pattern's $is call, Option.None, a variant of effect's Option, Exit or
// Result for which the module exports no value, reads the guard that tests
// the variant, Option.isNone.
func builtinVariantProperty(c *checker.Checker, node *ast.Node, receiver *checker.Type, name string) *ast.Symbol {
	if call := node.Parent; (!isPatternCall(call, "$is") && !isPatternCall(call, "$extract")) || call.Arguments()[0] != node {
		return nil
	}
	builtin, ok := builtinMatcherOf(c, node)
	if !ok || builtin.Guard == "" {
		return nil
	}
	return c.GetPropertyOfType(receiver, builtin.Guard)
}

// narrowBuiltinPattern narrows the subject of a built-in matcher's $is call
// as the test the lowering writes for it does: as typeof does for the class
// of a primitive, and as the module's guard does for a variant.
func narrowBuiltinPattern(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, _ func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if !isPatternCall(test, "$is") || !c.IsMatchingReference(reference, test.Arguments()[1]) {
		return nil
	}
	matcher := test.Arguments()[0]
	builtin, ok := builtinMatcherOf(c, matcher)
	if !ok {
		return nil
	}
	var candidate *checker.Type
	switch builtin.TypeOf {
	case "string":
		candidate = c.GetStringType()
	case "number":
		candidate = c.GetNumberType()
	case "boolean":
		candidate = c.GetBooleanType()
	case "bigint":
		candidate = c.GetBigIntType()
	case "symbol":
		candidate = c.GetESSymbolType()
	default:
		// The guard's predicate, its type parameters erased: Some<any>.
		signatures := c.GetSignaturesOfType(c.TypeOfPatternMatcher(matcher), checker.SignatureKindCall)
		if len(signatures) == 0 {
			return nil
		}
		predicate := c.GetTypePredicateOfSignature(c.GetErasedSignature(signatures[0]))
		if predicate == nil || predicate.Type() == nil {
			return nil
		}
		candidate = predicate.Type()
	}
	return c.NarrowTypeTo(t, candidate, assumeTrue)
}

// builtinTest is the test the lowering writes for a built-in matcher.
type builtinTest struct {
	typeOf  string // typeof subject === typeOf, for the class of a primitive
	guard   string // Module.guard(subject), for a variant
	module  string // the effect module that exports guard
	brand   string // Module.isModule(subject), tested before guard
	value   string // the extracted property, or "." for the subject itself
	extract bool   // the guard yields [value] in extractor mode
}

// visitBuiltinTest writes node, $is(matcher, subject) for a built-in
// matcher, as typeof subject === "string" or Option.isNone(subject).
func (tx *lowering) visitBuiltinTest(node *ast.Node, test builtinTest) *ast.Node {
	f := tx.Factory()
	subject := tx.Visitor().VisitNode(node.Arguments()[1])
	var lowered *ast.Node
	if test.typeOf != "" {
		lowered = f.NewBinaryExpression(nil /*modifiers*/, f.NewTypeOfExpression(subject), nil /*typeNode*/, f.NewToken(ast.KindEqualsEqualsEqualsToken), f.NewStringLiteral(test.typeOf, ast.TokenFlagsNone))
	} else {
		argument := subject
		subject = f.NewUniqueName("subject")
		module := tx.moduleNamespace("effect/" + test.module)
		callGuard := func(name string) *ast.Node {
			guard := f.NewPropertyAccessExpression(module, nil, f.NewIdentifier(name), ast.NodeFlagsNone)
			return f.NewCallExpression(guard, nil, nil, f.NewNodeList([]*ast.Node{subject}), ast.NodeFlagsNone)
		}
		lowered = callGuard(test.guard)
		if test.brand != "" {
			lowered = f.NewBinaryExpression(nil, callGuard(test.brand), nil, f.NewToken(ast.KindAmpersandAmpersandToken), lowered)
		}
		if test.extract {
			var values []*ast.Node
			if test.value == "." {
				values = append(values, subject)
			} else if test.value != "" {
				values = append(values, f.NewPropertyAccessExpression(subject, nil, f.NewIdentifier(test.value), ast.NodeFlagsNone))
			}
			lowered = f.NewBinaryExpression(nil, lowered, nil, f.NewToken(ast.KindAmpersandAmpersandToken), f.NewArrayLiteralExpression(f.NewNodeList(values), false))
		}
		arrow := tx.arrow([]*ast.Node{f.NewParameterDeclaration(nil, nil, subject, nil, nil, nil)}, lowered)
		lowered = f.NewCallExpression(f.NewParenthesizedExpression(arrow), nil, nil, f.NewNodeList([]*ast.Node{argument}), ast.NodeFlagsNone)
	}
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}

// builtinExtractionType gives the retained extractor its guard predicate's fields.
func builtinExtractionType(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	if !isPatternCall(call, "$extract") {
		return t
	}
	builtin, ok := builtinMatcherOf(c, call.Arguments()[0])
	if !ok || builtin.Guard == "" {
		return t
	}
	signatures := c.GetSignaturesOfType(c.TypeOfPatternMatcher(call.Arguments()[0]), checker.SignatureKindCall)
	if len(signatures) == 0 {
		return t
	}
	predicate := c.GetTypePredicateOfSignature(c.GetErasedSignature(signatures[0]))
	if predicate == nil || predicate.Type() == nil {
		return t
	}
	candidate := c.NarrowTypeTo(c.GetTypeAtLocation(call.Arguments()[1]), predicate.Type(), true)
	var fields []*checker.Type
	for _, name := range builtin.Values {
		field := candidate
		if name != "" {
			field = c.GetTypeOfPropertyOfType(candidate, name)
		}
		if field == nil {
			field = c.GetUnknownType()
		}
		fields = append(fields, field)
	}
	return c.CreatePatternExtractionType(fields)
}

// narrowBuiltinExtraction preserves the guard's relationship with its captured
// subject. The retained extractors return a fixed number of fields even though
// their array type permits wrong-arity patterns to compile and fail at runtime.
func narrowBuiltinExtraction(c *checker.Checker, reference *ast.Node, t *checker.Type, test *ast.Node, assumeTrue bool, _ func(*ast.Node, *checker.Type, *ast.Node) *checker.Type) *checker.Type {
	if !ast.IsBinaryExpression(test) {
		return nil
	}
	binary := test.AsBinaryExpression()
	if binary.OperatorToken.Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	left := binary.Left
	length := ast.IsPropertyAccessExpression(left) && left.Name().Text() == "length"
	if length {
		left = left.Expression()
	}
	call := extractionCall(c, left)
	if call == nil || (!c.IsMatchingReference(reference, call.Arguments()[1]) && !readsThroughCapture(c, reference, call.Arguments()[1])) {
		return nil
	}
	builtin, ok := builtinMatcherOf(c, call.Arguments()[0])
	if !ok || builtin.Guard == "" {
		return nil
	}
	if length && binary.Right.Kind == ast.KindNumericLiteral {
		n, err := strconv.Atoi(binary.Right.Text())
		if err != nil {
			return nil
		}
		var matches bool
		switch binary.OperatorToken.Kind {
		case ast.KindEqualsEqualsEqualsToken:
			matches = len(builtin.Values) == n
		case ast.KindGreaterThanEqualsToken:
			matches = len(builtin.Values) >= n
		default:
			return nil
		}
		if matches != assumeTrue {
			return c.GetNeverType()
		}
		return t
	}
	if !length && binary.Right.Kind == ast.KindFalseKeyword && binary.OperatorToken.Kind == ast.KindExclamationEqualsEqualsToken {
		signatures := c.GetSignaturesOfType(c.TypeOfPatternMatcher(call.Arguments()[0]), checker.SignatureKindCall)
		if len(signatures) == 0 {
			return nil
		}
		predicate := c.GetTypePredicateOfSignature(c.GetErasedSignature(signatures[0]))
		if predicate != nil && predicate.Type() != nil {
			return c.NarrowTypeTo(t, predicate.Type(), assumeTrue)
		}
	}
	return nil
}
