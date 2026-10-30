package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
}

// checkBuiltinPatterns reports TS2345 at the subject of a built-in variant's
// $is call that the module's guard does not take, as the call of the guard
// the lowering writes would: Option.isNone reads the _tag of an Option, and
// would throw for null, so a subject typed unknown or string | Option<number>
// is an error, as it was when the parser wrote the guard's call.
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
		if isPatternCall(node, "$is") {
			if builtin, ok := builtinMatcherOf(c, node.Arguments()[0]); ok && builtin.Guard != "" && fixedErrorGuards[builtin.Module] == nil {
				checkGuardSubject(c, node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkGuardSubject checks that the subject of call, a built-in variant's
// $is call, fits the parameter of the guard its matcher reads.
func checkGuardSubject(c *checker.Checker, call *ast.Node) {
	signatures := c.GetSignaturesOfType(c.TypeOfPatternMatcher(call.Arguments()[0]), checker.SignatureKindCall)
	if len(signatures) == 0 || len(signatures[0].Parameters()) == 0 {
		return
	}
	subject := call.Arguments()[1]
	parameter := c.GetTypeAtPosition(c.GetErasedSignature(signatures[0]), 0)
	c.CheckTypeAssignableTo(c.GetTypeAtLocation(subject), parameter, subject, diagnostics.Argument_of_type_0_is_not_assignable_to_parameter_of_type_1)
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
	}
	builtin, ok := parser.BuiltinMatcherNamed(matcher)
	switch {
	case !ok:
		return parser.BuiltinMatcher{}, false
	case builtin.TypeOf != "":
		if symbol := c.GetSymbolAtLocation(matcher); symbol == nil || symbol != c.GlobalSymbol(matcher.Text(), ast.SymbolFlagsValue) {
			return parser.BuiltinMatcher{}, false
		}
	case effectModuleNamed(c, matcher.Expression()) != builtin.Module:
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
	if call := node.Parent; !isPatternCall(call, "$is") || call.Arguments()[0] != node {
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
	extract bool   // the guard yields [subject] in extractor mode
}

// visitBuiltinTest writes node, $is(matcher, subject) for a built-in
// matcher, as typeof subject === "string" or Option.isNone(subject).
func (tx *lowering) visitBuiltinTest(node *ast.Node, test builtinTest) *ast.Node {
	f := tx.Factory()
	matcher, subject := node.Arguments()[0], tx.Visitor().VisitNode(node.Arguments()[1])
	var lowered *ast.Node
	if test.typeOf != "" {
		lowered = f.NewBinaryExpression(nil /*modifiers*/, f.NewTypeOfExpression(subject), nil /*typeNode*/, f.NewToken(ast.KindEqualsEqualsEqualsToken), f.NewStringLiteral(test.typeOf, ast.TokenFlagsNone))
	} else {
		guard := f.NewPropertyAccessExpression(tx.Visitor().VisitNode(matcher.Expression()), nil /*questionDotToken*/, f.NewIdentifier(test.guard), ast.NodeFlagsNone)
		lowered = f.NewCallExpression(guard, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{subject}), ast.NodeFlagsNone)
	}
	if test.extract {
		values := f.NewArrayLiteralExpression(f.NewNodeList([]*ast.Node{subject}), false)
		lowered = f.NewParenthesizedExpression(f.NewConditionalExpression(lowered, f.NewToken(ast.KindQuestionToken), values, f.NewToken(ast.KindColonToken), f.NewKeywordExpression(ast.KindFalseKeyword)))
	}
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}
