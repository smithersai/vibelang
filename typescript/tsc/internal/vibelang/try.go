package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// `try e` runs the Effect e where it stands and gives its success value
// (VIP-5). Before a call, the parser returns the call itself, flagged
// NodeFlagsVibeLangTry (parser/vibelang_try.go), so the checker, the
// analyzer, and the lowering see the call they see without try: while a
// call still runs where it stands without try, try before it means the call,
// and it is accepted exactly where the call runs (runsWhereItStands). Before
// any other operand, try p is $try(p), the runtime's identity on Effects,
// which the checker gives p's success type and the lowering writes as
// yield* p, or p itself where $try(p) is passed by name. Anything else, a
// call passed or held unrun or a value that is not an Effect, is EK0502.
//
// try(…) was a hatch, Effect.try with its inputs after its function (D148).
// It now parses as try applied to the parenthesized operand, and EK4616
// reports it, with the quick fix, which vibelang --fix applies, that writes
// Effect's own wrapper:
//
//	try((text) => JSON.parse(text), text)        try Effect.try(() => ((text) => JSON.parse(text))(text))
//	try(() => parse(text), (e) => new Bad({ e }))  try Effect.try({ try: () => parse(text), catch: (e) => new Bad({ e }) })
//	try(async (signal) => load(signal))           try Effect.tryPromise(async (signal) => load(signal))

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
	tsFormFixCodes = append(tsFormFixCodes, EK4616.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK4616.Code)
	tsFormRules[EK4616.Code] = &tsFormRule{
		message:   EK4616,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      retiredTryRewrite,
		diagnosed: isTryCall,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4616.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
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
	if arguments := retiredTryArguments(operand); arguments != nil {
		rewrite := retiredTryRewrite(c, file, call)
		wrapper := "Effect.try or Effect.tryPromise"
		d := reportAt(c, file, tsFormSpan(file, call), EK4616, wrapper)
		if rewrite.fixable() {
			note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", rewrite.description)
		} else if rewrite.why != "" {
			note(d, "{0}", rewrite.why)
		}
		cover(c, call)
		return
	}
	t := c.GetTypeAtLocation(operand)
	if t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 || isEffectType(c, t) || isEffectType(c, presentCallResult(c, t)) {
		return
	}
	text := shortText(expressionText(file, operand), "the operand")
	d := report(c, operand, EK0502, text, "not an Effect: "+c.TypeToString(t))
	switch {
	case c.GetPromisedTypeOfPromise(t) != nil:
		note(d, "Wrap the promise: try Effect.tryPromise(() => {0}).", expressionText(file, operand))
	case ast.IsCallExpression(ast.SkipParentheses(operand)):
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

// checkTriedCall checks `try f()`, which parses as the call f() flagged
// NodeFlagsVibeLangTry. The try is accepted where the call runs where it
// stands (runsWhereItStands): it means what the call means without it.
// Where an Effect call cannot run at all, at a module's top level or in a
// plain function, the error that the call draws without try stands alone.
// A call this position passes by name or holds as a program, or one that
// returns anything but an Effect, is EK0502.
func checkTriedCall(c *checker.Checker, file *ast.SourceFile, operand *ast.Node) {
	keyword := tryKeyword(file, operand)
	call := ast.SkipParentheses(operand)
	a := analyzerFor(c)
	if runsWhereItStands(a, call) {
		return
	}
	text := shortText(triedText(file, operand), "the call")
	if a.performs(call) && a.byNameOf(call) == nil && !inHatch(call) {
		return // EK1001, EK9203, or EK4301 already reports the call
	}
	if isInvocation(call) && (a.performs(call) || callReturnsEffect(c, call)) {
		switch {
		case a.byNameOf(call) != nil:
			note(reportAt(c, file, keyword, EK0502, text, "a program this position passes by name without running it"), "Remove try to pass the program, or run it first: const value = try {0}.", text)
		case holdsProgram(c, call):
			note(reportAt(c, file, keyword, EK0502, text, "a program this position holds without running it"), "Remove try to hold the program, or run it first: const value = try {0}.", text)
		default:
			note(reportAt(c, file, keyword, EK0502, text, "a call of a function that compiles to plain JavaScript, which runs no Effect"), "Remove try: the call gives its value.")
		}
		return
	}
	t := c.GetTypeAtLocation(operand)
	if t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0 {
		return
	}
	d := reportAt(c, file, keyword, EK0502, text, "not an Effect: "+c.TypeToString(t))
	if c.GetPromisedTypeOfPromise(t) != nil {
		note(d, "Wrap the promise: try Effect.tryPromise(() => {0}).", text)
	} else {
		note(d, "Call it without try, or wrap a call that may throw: try Effect.try(() => {0}).", text)
	}
}

// retiredTryArguments returns the arguments of a retired try(…) hatch that
// operand, the operand of $try, writes: parentheses around a function
// literal, or around a comma list, the hatch's arguments. It returns nil for
// any other operand, which try runs.
func retiredTryArguments(operand *ast.Node) []*ast.Node {
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
	if len(arguments) == 1 && !ast.IsFunctionExpressionOrArrowFunction(ast.SkipParentheses(inner)) {
		return nil
	}
	return arguments
}

// retiredTryRewrite plans EK4616's fix of call, $try((args…)): the hatch's
// function, or its value, becomes the thunk of Effect.try, or of
// Effect.tryPromise when the function is async or the value a promise; a
// mapper, a function in second place (D231), becomes the wrapper's catch;
// and the inputs become the function's arguments, called inside the thunk.
// The thunk evaluates the inputs when the Effect runs, where the hatch
// evaluated them before, so only inputs that read a name, a literal, or a
// property of a name are moved. The try stays where the hatch ran, and
// goes where the hatch was passed by name, which now passes the wrapper.
func retiredTryRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	operand := tryOperand(call)
	arguments := retiredTryArguments(operand)
	if arguments == nil {
		return nil
	}
	evaluate := ast.SkipParentheses(arguments[0])
	rest := arguments[1:]
	var mapper *ast.Node
	if len(rest) > 0 && ast.IsFunctionExpressionOrArrowFunction(ast.SkipParentheses(rest[0])) {
		mapper, rest = rest[0], rest[1:]
	}
	literal := ast.IsFunctionExpressionOrArrowFunction(evaluate)
	function, async, signal := literal, false, false
	if t := c.GetTypeAtLocation(evaluate); t != nil {
		if signatures := c.GetSignaturesOfType(t, checker.SignatureKindCall); len(signatures) > 0 {
			function = true
			async = c.GetPromisedTypeOfPromise(c.GetReturnTypeOfSignature(signatures[0])) != nil
			// The hatch gave an async function the AbortSignal after its
			// inputs when the parameter there takes one (D230).
			if parameters := signatures[0].Parameters(); len(rest) < len(parameters) {
				signal = strings.Contains(c.TypeToString(c.GetTypeOfSymbol(parameters[len(rest)])), "AbortSignal")
			}
		} else {
			async = c.GetPromisedTypeOfPromise(t) != nil
		}
	}
	if literal {
		async = ast.GetFunctionFlags(evaluate)&ast.FunctionFlagsAsync != 0
	}
	for _, input := range rest {
		if !isStableInput(input) {
			return &formRewrite{why: "Its inputs run code, so write Effect.try yourself, binding each input to a const first."}
		}
	}
	code := nodeText(file, arguments[0])
	var thunk string
	switch {
	case !function:
		thunk = "() => " + code
	case literal && len(rest) == 0:
		thunk = code
	default:
		inputs := make([]string, len(rest))
		for i, input := range rest {
			inputs[i] = nodeText(file, input)
		}
		callee := code
		if literal && !ast.IsParenthesizedExpression(arguments[0]) {
			callee = "(" + code + ")"
		}
		if async && signal {
			thunk = "(signal) => " + callee + "(" + strings.Join(append(inputs, "signal"), ", ") + ")"
		} else {
			thunk = "() => " + callee + "(" + strings.Join(inputs, ", ") + ")"
		}
	}
	wrapper := "Effect.try"
	if async {
		wrapper = "Effect.tryPromise"
	}
	text := wrapper + "(" + thunk + ")"
	if mapper != nil {
		text = wrapper + "({ try: " + thunk + ", catch: " + nodeText(file, mapper) + " })"
	}
	start := scanner.SkipTrivia(file.Text(), call.Pos())
	if hatchRan(analyzerFor(c), call) {
		text = "try " + text
	}
	return &formRewrite{edits: []sourceEdit{{start, call.End(), text}}, description: text}
}

// hatchRan reports whether call, a retired try hatch, ran where it stood, as
// a call of an Effect ran there: in the body of an Effect function, outside
// any expression passed by name or held. Its operand's type no longer
// says what it ran, so the position alone decides.
func hatchRan(a *analyzer, call *ast.Node) bool {
	if !inLowerableBody(call) || inHatch(call) || a.byNameOf(call) != nil || holdsProgram(a.checker, call) || isCatchLeft(call) {
		return false
	}
	fn := enclosingFunction(call)
	return fn != nil && a.isEffect(fn)
}

// isStableInput reports whether evaluating input, an input of a retired try
// hatch, later gives what evaluating it at the hatch gave: a name, a literal,
// or a property of one.
func isStableInput(input *ast.Node) bool {
	input = ast.SkipParentheses(input)
	switch {
	case ast.IsIdentifier(input), ast.IsLiteralExpression(input), input.Kind == ast.KindTrueKeyword, input.Kind == ast.KindFalseKeyword, input.Kind == ast.KindNullKeyword, input.Kind == ast.KindThisKeyword:
		return true
	case ast.IsPropertyAccessExpression(input) && input.QuestionDotToken() == nil:
		return isStableInput(input.Expression())
	}
	return false
}

// runsWhereItStands reports whether call, an invocation, runs where it
// stands, as the lowering plans it (plan.go): the analyzer performs it, as an
// Effect, through an Effect function's direct variant, or as a service
// lookup, in the body of a function the lowering makes an Effect, outside
// any expression passed by name, such as an await operation's element or
// fork's operand.
func runsWhereItStands(a *analyzer, call *ast.Node) bool {
	if !inLowerableBody(call) || inHatch(call) || a.byNameOf(call) != nil {
		return false
	}
	if fn := enclosingFunction(call); fn == nil || !a.isEffect(fn) {
		return false
	}
	return a.performs(call)
}

// visitTry lowers $try(e) where it does not run, as where it is passed by
// name: e itself, the Effect it names.
func (tx *lowering) visitTry(node *ast.Node) *ast.Node {
	return tx.Visitor().VisitNode(tryOperand(node))
}
