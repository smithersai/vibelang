package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The retired try hatch reports EK4616. Use an explicit Effect.try or
// Effect.tryPromise wrapper and run the resulting Effect with try.

var (
	// EK0502: try before something that is not an Effect. {0} is the operand, {1} its type.
	EK0502 = message(502, errorCategory, "try runs an Effect, but {0} is {1}.")
	// EK4616: the retired try(…) hatch. {0} is the wrapper that replaces it.
	EK4616 = message(4616, errorCategory, "try(…) is no longer a hatch: try runs an Effect. Wrap the code with {0}, then run it with try.")
)

func init() {
	registry[EK0502.Code] = EK0502
	registry[EK4616.Code] = EK4616
	fileChecks = append(fileChecks, checkTries)
	tsFormRules[EK4616.Code] = &tsFormRule{
		message: EK4616,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}

// isTryCall reports whether node is $try(e), which the parser writes for try e.
func isTryCall(node *ast.Node) bool {
	if node == nil || !ast.IsCallExpression(node) || len(node.Arguments()) != 1 {
		return false
	}
	callee := node.Expression()
	return callee.Kind == ast.KindIdentifier && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$try"
}

// tryOperand returns e of $try(e), or nil.
func tryOperand(node *ast.Node) *ast.Node {
	if !isTryCall(node) {
		return nil
	}
	return node.Arguments()[0]
}

// checkTries reports each try of file that runs nothing: a call that does
// not run where it stands, a retired try(…) hatch (EK4616), or a value that
// is not an Effect (EK0502).
func checkTries(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTry(ast.SkipParentheses(node)) && !inEffectCode(node) {
			return node.ForEachChild(visit) // EK0501 (try_outside.go), also for try (f())
		}
		if node.Flags&ast.NodeFlagsVibeLangTry != 0 {
			checkTriedCall(c, file, node)
		}
		if operand := tryOperand(node); operand != nil && !ast.NodeIsMissing(operand) {
			checkTry(c, file, node, operand)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkTry(c *checker.Checker, file *ast.SourceFile, call, operand *ast.Node) {
	if arguments := retiredTryArguments(c, operand); arguments != nil {
		wrapper := "Effect.try or Effect.tryPromise"
		reportAt(c, file, tsFormSpan(file, call), EK4616, wrapper)

		cover(c, call)
		return
	}
	t := c.GetTypeAtLocation(operand)
	if t == nil || isEffectOperandType(c, t) {
		return
	}
	text := shortText(expressionText(file, operand), "the operand")
	d := report(c, operand, EK0502, text, "not an Effect: "+c.TypeToString(t))
	switch {
	case failsAsError(c, t):
		note(d, "To fail with the error, as yield* {0} does, write throw {0}.", expressionText(file, operand))
	case yieldsEffect(c, t):
		note(d, "To run it as yield* {0} does, write try {0}.asEffect().", expressionText(file, operand))
	case c.GetPromisedTypeOfPromise(t) != nil:
		note(d, "Wrap the promise: try Effect.tryPromise(() => {0}).", expressionText(file, operand))
	case ast.IsCallExpression(ast.SkipParentheses(operand)) && !parser.IsVibeLangSynthesizedCall(ast.SkipParentheses(operand)) && tryOperationName(ast.SkipParentheses(operand)) == "" && !isTryCall(ast.SkipParentheses(operand)):
		// A do or match expression, try.all and the other operations and an
		// inner try are calls only as the parser writes them: the source has
		// no call to keep.
		note(d, "Call it without try, or wrap a call that may throw: try Effect.try(() => {0}).", expressionText(file, operand))
	default:
		note(d, "Remove try: a value that is not an Effect has nothing to run.")
	}
	cover(c, call)
}

// tryKeyword returns the range of the try keyword written before operand, a
// node the parser flagged NodeFlagsVibeLangTry, whose first token it is.
func tryKeyword(file *ast.SourceFile, operand *ast.Node) core.TextRange {
	start := scanner.SkipTrivia(file.Text(), operand.Pos())
	return core.NewTextRange(start, start+len("try"))
}

// triedText returns the text of operand, a node the parser flagged
// NodeFlagsVibeLangTry, without its try: f() for try f().
func triedText(file *ast.SourceFile, operand *ast.Node) string {
	return strings.TrimSpace(file.Text()[tryKeyword(file, operand).End():operand.End()])
}

// checkTriedCall checks `try f()` in effect code, which parses as the call
// f() flagged NodeFlagsVibeLangTry: the try runs the Effect the call returns
// (runsWhereItStands). Outside effect code it is EK0501 (try_outside.go). A
// call this position holds as a program, or one that
// returns anything but an Effect, is EK0502.
func checkTriedCall(c *checker.Checker, file *ast.SourceFile, operand *ast.Node) {
	keyword := tryKeyword(file, operand)
	call := ast.SkipParentheses(operand)
	text := shortText(triedText(file, operand), "the call")
	if inEffectCode(call) && serviceLookup(c, call) != nil {
		return // try S.member(…) runs the service lookup (D41)
	}
	if isInvocation(call) && callReturnsEffect(c, call) && holdsProgram(c, call) {
		note(reportAt(c, file, keyword, EK0502, text, "a program this position holds without running it"), "Remove try to hold the program, or run it first: const value = try {0}.", text)
		return
	}
	t := effectOperandType(c, operand)
	if t == nil || isEffectOperandType(c, t) {
		return
	}
	d := reportAt(c, file, keyword, EK0502, text, "not an Effect: "+c.TypeToString(t))
	switch {
	case failsAsError(c, t):
		note(d, "To fail with the error, as yield* {0} does, write throw {0}.", text)
	case yieldsEffect(c, t):
		note(d, "To run it as yield* {0} does, write try {0}.asEffect().", text)
	case c.GetPromisedTypeOfPromise(t) != nil:
		note(d, "Wrap the promise: try Effect.tryPromise(() => {0}).", text)
	default:
		note(d, "Call it without try, or wrap a call that may throw: try Effect.try(() => {0}).", text)
	}
}

// retiredTryArguments returns the arguments of a retired try(…) hatch that
// operand, the operand of $try, writes: parentheses around a function
// literal, or around a comma list, the hatch's arguments. It returns nil for
// any other operand, which try runs.
func retiredTryArguments(c *checker.Checker, operand *ast.Node) []*ast.Node {
	if !ast.IsParenthesizedExpression(operand) {
		return nil
	}
	inner := operand.Expression()
	var arguments []*ast.Node
	var flatten func(n *ast.Node)
	flatten = func(n *ast.Node) {
		if ast.IsBinaryExpression(n) && n.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
			flatten(n.AsBinaryExpression().Left)
			arguments = append(arguments, n.AsBinaryExpression().Right)
			return
		}
		arguments = append(arguments, n)
	}
	flatten(inner)
	if len(arguments) > 1 {
		// A comma expression whose value is an Effect is an ordinary operand.
		// The retired hatch must not override VIP-5's operand test.
		base := analyzerFor(c).programEffectInterface()
		t := c.GetTypeAtLocation(operand)
		if base != nil && t != nil {
			any := c.GetAnyType()
			if c.IsTypeAssignableTo(t, c.NewTypeReference(base, []*checker.Type{any, any, any})) {
				return nil
			}
		}
	}
	if len(arguments) == 1 {
		value := ast.SkipParentheses(inner)
		// An effect block's synthesized arrow is the Effect value try runs.
		if isEffectBlock(value) || !ast.IsFunctionExpressionOrArrowFunction(value) {
			return nil
		}
	}
	return arguments
}

// freshName returns base, or base with a number after it, spelled nowhere in
// file, so a binding the codemod writes shadows and captures nothing.
func freshName(file *ast.SourceFile, base string) string {
	name := base
	for i := 2; strings.Contains(file.Text(), name); i++ {
		name = base + strconv.Itoa(i)
	}
	return name
}

// runsWhereItStands reports whether call, an invocation, runs where it
// stands, as the lowering plans it (plan.go): the analyzer performs it, as an
// Effect, through an Effect function's direct variant, or as a service
// lookup, in the body of a function the lowering makes an Effect, outside
// any expression passed by name, such as an await operation's element or
// fork's operand.
func runsWhereItStands(a *analyzer, call *ast.Node) bool {
	if !a.runs(call) {
		return false
	}
	signature := a.checker.GetResolvedSignature(call)
	if signature == nil {
		return true
	}
	t := a.checker.GetReturnTypeOfSignature(signature)
	return t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 || callRunsResult(a.checker, call, t)
}

// visitTry lowers $try(e) where it does not run, as where it is passed by
// name: e itself, the Effect it names.
func (tx *lowering) visitTry(node *ast.Node) *ast.Node {
	return tx.Visitor().VisitNode(tryOperand(node))
}

// EK1803: a name after try. other than all, race, any or allSettled; the
// parser reports it (parser.TryOperationNameMessage, VIP-18).
var EK1803 = message(1803, errorCategory, parser.TryOperationNameMessage)

func init() {
	registry[EK1803.Code] = EK1803
}
