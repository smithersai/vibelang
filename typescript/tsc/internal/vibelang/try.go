package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strconv"
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
//	try((text) => JSON.parse(text), text)        try Effect.try(() => JSON.parse(text))
//	try((text) => JSON.parse(text), "1")         try Effect.try(() => { let text = "1"; return JSON.parse(text) })
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
	if len(arguments) == 1 {
		value := ast.SkipParentheses(inner)
		// An effect block's synthesized arrow is the Effect value try runs.
		if isEffectBlock(value) || !ast.IsFunctionExpressionOrArrowFunction(value) {
			return nil
		}
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
	mapper, rest := retiredTryMapper(c, arguments[1:])
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
		if inlined, ok := inlinedThunk(file, evaluate, rest, async); ok {
			thunk = inlined
			break
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

// inlinedThunk writes the thunk for a synchronous arrow literal called with
// inputs as the arrow's own body, each parameter whose input is another
// expression bound first with let (a body may assign its parameter):
//
//	try((text) => JSON.parse(text), text)   () => JSON.parse(text)
//	try((text) => JSON.parse(text), "1")    () => { let text = "1"; return JSON.parse(text) }
//
// A parameter whose input is its own name is still a binding of its own
// (PREVIEW-3): when the body assigns it or a function in the body captures
// it, or it has a written type, the thunk copies the caller's value to a
// fresh const and rebinds the parameter in an inner block, so a write or a
// later closure call never reaches the caller's variable:
//
//	try((text) => () => text, text)         () => { const textInput = text; { let text = textInput; return () => text } }
//
// The thunk then holds no plain function of its own, so a call known to
// throw in the body belongs to Effect.try, as chapter 3 has it, where the
// arrow called in place would be plain code that throws (EK0401). The
// arrow's written return type stays on the thunk. It reports false, keeping
// the arrow called in place, for a function expression (its this and
// arguments are its own), a type parameter, a parameter with a default, a
// rest parameter or a pattern, and an input that names a parameter the thunk
// binds with let from another input.
func inlinedThunk(file *ast.SourceFile, fn *ast.Node, inputs []*ast.Node, async bool) (string, bool) {
	if async || fn.Kind != ast.KindArrowFunction || ast.GetFunctionFlags(fn)&ast.FunctionFlagsAsync != 0 || len(fn.TypeParameters()) != 0 {
		return "", false
	}
	parameters := fn.Parameters()
	if len(parameters) != len(inputs) {
		return "", false
	}
	var copies, rebound, bound []string
	names := map[string]bool{}
	for i, parameter := range parameters {
		p := parameter.AsParameterDeclaration()
		if !ast.IsIdentifier(p.Name()) || p.Initializer != nil || p.DotDotDotToken != nil || p.QuestionToken != nil {
			return "", false
		}
		name := p.Name().Text()
		input := ast.SkipParentheses(inputs[i])
		if ast.IsIdentifier(input) && input.Text() == name {
			if p.Type == nil && !assignsOrCaptures(fn.Body(), name) {
				continue
			}
			copy := freshName(file, name+"Input")
			copies = append(copies, "const "+copy+" = "+name)
			rebound = append(rebound, "let "+nodeText(file, parameter)+" = "+copy)
			continue
		}
		names[name] = true
		bound = append(bound, "let "+nodeText(file, parameter)+" = "+nodeText(file, inputs[i]))
	}
	head := "() => "
	if returns := fn.Type(); returns != nil {
		head = "(): " + nodeText(file, returns) + " => "
	}
	if !core.Every(inputs, isPlainValueInput) {
		return evaluatedThunk(file, fn, head, inputs), true
	}
	for i := range parameters {
		root := ast.SkipParentheses(inputs[i])
		for ast.IsPropertyAccessExpression(root) {
			root = ast.SkipParentheses(root.Expression())
		}
		if ast.IsIdentifier(root) && names[root.Text()] && !(ast.IsIdentifier(ast.SkipParentheses(inputs[i])) && ast.SkipParentheses(inputs[i]).Text() == parameters[i].Name().Text()) {
			return "", false // let b = a after let a = … reads the new a
		}
	}
	body := fn.Body()
	text := nodeText(file, body)
	if len(copies) != 0 {
		// The rebound parameters come first: another input that reads one
		// of them reads the same value from the new binding.
		prefix := head + "{ " + strings.Join(copies, "; ") + "; { " + strings.Join(append(rebound, bound...), "; ") + ";"
		if ast.IsBlock(body) {
			return prefix + text[1:] + " }", true
		}
		return prefix + " return " + text + " } }", true
	}
	if len(bound) == 0 {
		return head + text, true
	}
	prefix := head + "{ " + strings.Join(bound, "; ") + ";"
	if ast.IsBlock(body) {
		return prefix + text[1:], true
	}
	return prefix + " return " + text + " }", true
}

// isPlainValueInput reports whether input, a stable hatch input, reads a
// value without running code: a name, a literal or a keyword. A property
// access may run a getter, which can change a variable another input or a
// parameter reads.
func isPlainValueInput(input *ast.Node) bool {
	return !ast.IsPropertyAccessExpression(ast.SkipParentheses(input))
}

// evaluatedThunk writes a hatch arrow as the thunk the way the call evaluated
// it: each input once, left to right, in the caller's scope, into a fresh
// const, then each parameter bound to its copy in an inner block, so a getter
// among the inputs changes nothing the other inputs or parameters read
// (PREVIEW-3, rev-preview pass 41).
func evaluatedThunk(file *ast.SourceFile, fn *ast.Node, head string, inputs []*ast.Node) string {
	var copies, bound []string
	for i, parameter := range fn.Parameters() {
		copy := freshName(file, parameter.Name().Text()+"Input")
		copies = append(copies, "const "+copy+" = "+nodeText(file, inputs[i]))
		bound = append(bound, "let "+nodeText(file, parameter)+" = "+copy)
	}
	body := fn.Body()
	text := nodeText(file, body)
	prefix := head + "{ " + strings.Join(copies, "; ") + "; { " + strings.Join(bound, "; ") + ";"
	if ast.IsBlock(body) {
		return prefix + text[1:] + " }"
	}
	return prefix + " return " + text + " } }"
}

// assignsOrCaptures reports whether body may assign name or capture it in a
// function nested in it: an identifier spelled name that is an assignment
// target (=, a compound assignment, ++, --, a destructuring or a for-in/of
// head) or sits in a nested function or class. It reads spelling, not
// symbols, so a shadowing declaration only makes it answer true more often.
func assignsOrCaptures(body *ast.Node, name string) bool {
	var visit func(node *ast.Node, nested bool) bool
	visit = func(node *ast.Node, nested bool) bool {
		if ast.IsIdentifier(node) && node.Text() == name {
			return nested || ast.IsAssignmentTarget(node)
		}
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			nested = true
		}
		return node.ForEachChild(func(child *ast.Node) bool { return visit(child, nested) })
	}
	return visit(body, false)
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

// retiredTryMapper splits the arguments after a retired try hatch's function
// into its mapper and its inputs. The second argument was the mapper (D330:
// "try's second argument is always the mapper, as the runtime's try already
// read it"), a function literal or a function by name, such as a handler
// bound to a const; undefined there left the place empty, to pass inputs
// without one. Any other value is an input, as D148's try(f, text) passed it.
func retiredTryMapper(c *checker.Checker, rest []*ast.Node) (*ast.Node, []*ast.Node) {
	if len(rest) == 0 {
		return nil, rest
	}
	second := ast.SkipParentheses(rest[0])
	if ast.IsIdentifier(second) && second.Text() == "undefined" {
		return nil, rest[1:]
	}
	if ast.IsFunctionExpressionOrArrowFunction(second) {
		return rest[0], rest[1:]
	}
	if t := c.GetTypeAtLocation(second); t != nil && len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) > 0 {
		return rest[0], rest[1:]
	}
	return nil, rest
}

// hatchRan reports whether call, a retired try hatch, ran where it stood, as
// a call of an Effect ran there: in the body of an Effect function, outside
// any expression passed by name or held. Its operand's type no longer
// says what it ran, so the position alone decides.
func hatchRan(a *analyzer, call *ast.Node) bool {
	if !inLowerableBody(call) || inHatch(call) || holdsProgram(a.checker, call) || isCatchLeft(call) {
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
