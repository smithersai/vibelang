package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Keyword operands are the evaluation plan's syntax-owned regions (D322,
// D377, D391, D394, D433). These forms build a program from their operand
// by syntax, whatever the operand's type:
//
//	fork e, fork(e)                       () => e, run on a new fiber
//	await.all [a, b], await.all { k: a }  each element as () => element, each
//	                                      on its own fiber; likewise
//	                                      allSettled, race and any
//
// In effect code fork(e) is the operation whatever is in scope: fork and join
// are reserved there, and a binding of either name is EK1702 (VIP-17, amended).
// In plain code a fork the program declares is an ordinary call. Typing, flow, hover and lowering ask
// keywordOperand whether an operand runs where it stands, never the
// destination's type: D147's type-chosen deferral no longer reaches these
// operands, so a plain call such as events.push("x") runs in the new fiber
// too. The operand's program succeeds with the operand's value, which is
// never run again: an operand that is not an Effect is EK1703,
// and an await element that is a fiber or a Deferred is EK4609 or EK4610
// (D394, D433). For such an operand, which no compiling program has, the
// compiler keeps the reading its repair gives, so the error stands alone.

// EK1703: a fork operand that is not an Effect (VIP-17). {0} is the operand, {1} its type.
var EK1703 = message(1703, errorCategory, "fork runs an Effect on a new fiber, but {0} is {1}.")

func init() {
	registry[EK1703.Code] = EK1703
	fileChecks = append(fileChecks, checkKeywordOperands)
	checker.RegisterCallArgumentDiagnosticsFilterHook(filterRejectedForkArgumentDiagnostics)
}

// mayBeKeywordOperand is the cheap test that runs on every expression: node
// stands where a keyword operand stands, an argument, an array element, or a
// property value, so keywordFormOf may decide it.
func mayBeKeywordOperand(node *ast.Node) bool {
	parent := node.Parent
	if parent == nil {
		return false
	}
	switch parent.Kind {
	case ast.KindCallExpression:
		return parent.Expression() != node && ast.IsIdentifier(parent.Expression()) && parent.Expression().Text() == "fork"
	case ast.KindParenthesizedExpression, ast.KindArrayLiteralExpression, ast.KindPropertyAssignment, ast.KindShorthandPropertyAssignment:
		return true
	}
	return false
}

// outerParentheses returns the outermost parenthesized expression around
// node, or node itself.
func outerParentheses(node *ast.Node) *ast.Node {
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	return node
}

// awaitLiteralOperation returns the await operation whose array or object
// literal operand has element as an element, or nil: an array element other
// than a spread or a hole, or an object literal's property value. element
// is as written, its parentheses included; the operand may be parenthesized,
// as in await.all([a(), b()]). Syntax alone decides (D377).
func awaitLiteralOperation(element *ast.Node) *ast.Node {
	parent := element.Parent
	if parent == nil {
		return nil
	}
	var literal *ast.Node
	switch parent.Kind {
	case ast.KindArrayLiteralExpression:
		if ast.IsSpreadElement(element) || element.Kind == ast.KindOmittedExpression {
			return nil
		}
		literal = parent
	case ast.KindPropertyAssignment:
		if parent.Initializer() != element {
			return nil
		}
		literal = parent.Parent
	case ast.KindShorthandPropertyAssignment:
		if parent.Name() != element {
			return nil
		}
		literal = parent.Parent
	default:
		return nil
	}
	operand := outerParentheses(literal)
	call := operand.Parent
	if call == nil || awaitOperationNames[fiberHelper(call)] == "" || len(call.Arguments()) != 1 || call.Arguments()[0] != operand {
		return nil
	}
	return call
}

// isForkBlock reports whether node is the arrow the parser writes for
// fork { … }, whose block is the program (D166).
func isForkBlock(node *ast.Node) bool {
	return isProgramArrow(node)
}

// keywordFork returns the fork whose operand is operand, as written with its
// parentheses: the only argument of a call spelled fork whose callee
// resolves to the prelude's fork, written fork e or fork(e) (D391, D432).
// The arrow of fork { … } is not an operand: its block is the program.
func (a *analyzer) keywordFork(operand *ast.Node) *ast.Node {
	call := operand.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() == operand || len(call.Arguments()) != 1 || call.Arguments()[0] != operand {
		return nil
	}
	if isForkBlock(operand) || !a.isPreludeFork(call) {
		return nil
	}
	return call
}

// keywordFormOf returns the keyword form that owns node as its operand by
// syntax, a fork or an await operation, or nil. node is the operand inside
// its parentheses; a function literal there is excluded, since its type is
// a program, which EK1703 reports, and it keeps the form its destination
// gives it.
func (a *analyzer) keywordFormOf(node *ast.Node) *ast.Node {
	if node == nil || node.Parent == nil || ast.IsParenthesizedExpression(node) || ast.IsFunctionExpressionOrArrowFunction(node) {
		return nil
	}
	file := ast.GetSourceFileOfNode(node)
	if !isVibeLangFile(file) || inHatch(node) {
		return nil
	}
	outer := outerParentheses(node)
	return awaitLiteralOperation(outer)
}

// keywordOperand reports whether node is a keyword operand whose program its
// syntax builds (D322). An operand whose value is already a program, a fiber,
// or a Deferred is an error, reported by checkKeywordOperands; its value
// keeps the reading the repair gives.
func (a *analyzer) keywordOperand(node *ast.Node) bool {
	if a.keywordFormOf(node) == nil {
		return false
	}
	if value, ok := a.keywordValues[node]; ok {
		return !a.keywordRejects(node, value)
	}
	// Not typed yet: checking the form types it, through expressionType.
	if call := a.keywordFormOf(node); call != nil {
		a.checker.GetResolvedSignature(call)
	}
	value, ok := a.keywordValues[node]
	return ok && !a.keywordRejects(node, value)
}

// keywordRejects reports whether value, the value of node, a keyword
// operand, makes it an error that keeps its repair's reading: a program, or,
// as an await element, a fiber or a Deferred.
func (a *analyzer) keywordRejects(node *ast.Node, value *checker.Type) bool {
	if value == nil || isPlaceholderNever(value) {
		return false
	}
	if a.isProgramValueType(value) {
		return true
	}
	if awaitLiteralOperation(outerParentheses(node)) != nil {
		return isFiberType(a.checker, value) || isDeferredType(a.checker, value)
	}
	return false
}

// isProgramValueType reports whether t is a program: definitely an Effect, or
// a function with no required parameters (D381). A union is one when each of
// its members is.
func (a *analyzer) isProgramValueType(t *checker.Type) bool {
	c := a.checker
	if t == nil || t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever) != 0 {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !a.isProgramValueType(member) {
				return false
			}
		}
		return len(t.Types()) > 0
	}
	if isEffectType(c, t) {
		return true
	}
	for _, signature := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		if signature.MinArgumentCount() == 0 {
			return true
		}
	}
	return false
}

// isFiberType and isDeferredType report whether every member of t is a
// Fiber, or a Deferred.
func isFiberType(c *checker.Checker, t *checker.Type) bool {
	return everyMember(t, func(member *checker.Type) bool { return c.GetPropertyOfType(member, "~effect/Fiber") != nil })
}

func isDeferredType(c *checker.Checker, t *checker.Type) bool {
	return everyMember(t, func(member *checker.Type) bool { return isDeferred(c, member) })
}

func everyMember(t *checker.Type, test func(*checker.Type) bool) bool {
	if t == nil || t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !test(member) {
				return false
			}
		}
		return len(t.Types()) > 0
	}
	return test(t)
}

// keywordProgramType returns Effect<A, E, R> for node, a keyword operand
// whose value has type success: E and R are what running node adds, as for
// the body of () => node. Unlike a by-name argument's, no program in a
// result position is unwrapped: the operand's value is the result.
func (a *analyzer) keywordProgramType(node *ast.Node, success *checker.Type) *checker.Type {
	if isPlaceholderNever(success) {
		return success // an inference pass that skipped a generic call infers nothing from it
	}
	info := a.flowOf(node)
	effect := info.effect
	if effect == nil {
		effect = a.programEffectInterface()
	}
	if effect == nil {
		effect = a.effectInterface
	}
	if effect == nil {
		return nil
	}
	errors, requirements := a.channelUnions(info, effect)
	return a.checker.NewTypeReference(effect, []*checker.Type{success, errors, requirements})
}

// keywordOperandType is expressionType's step for a keyword operand: it
// records the operand's value and gives it its program's type, the same for
// every candidate. It reports false for anything else, and for an operand
// that is an error, which keeps the reading its repair gives.
func (a *analyzer) keywordOperandType(node *ast.Node, t *checker.Type) (*checker.Type, bool) {
	call := a.keywordFormOf(node)
	if call == nil {
		return t, false
	}
	value := a.valueTypeOf(node, t)
	if !isPlaceholderNever(value) {
		a.keywordValues[node] = value
	}
	if a.keywordRejects(node, value) {
		return t, false
	}
	program := a.keywordProgramType(node, value)
	if program == nil {
		return t, false
	}
	return program, true
}

// keywordValueType returns the value type of node, a keyword operand, as its
// form's check left it, or its type when no check recorded one.
func (a *analyzer) keywordValueType(node *ast.Node) *checker.Type {
	if call := a.keywordFormOf(node); call != nil && a.keywordValues[node] == nil {
		a.checker.GetResolvedSignature(call)
	}
	if value := a.keywordValues[node]; value != nil {
		return value
	}
	return a.checker.GetTypeAtLocation(node)
}

// keywordWhat names what would give back an operand of call unrun.
func keywordWhat(call *ast.Node) string {
	if name := awaitOperationNames[fiberHelper(call)]; name != "" {
		return name
	}
	return "fork's new fiber"
}

// checkKeywordOperands reports EK1703 for a fork operand that is not an Effect.
// Retired await syntax retains its typing recorder and reports EK1802.
func checkKeywordOperands(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindModuleDeclaration || awaitOperationNames[fiberHelper(node)] != "" {
			return false
		}
		if ast.IsCallExpression(node) && !inHatch(node) && len(node.Arguments()) == 1 && a.keywordFork(node.Arguments()[0]) != nil && inEffectCode(node) {
			checkForkOperand(c, file, node.Arguments()[0])
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// forkOperandRejected reports whether operand, fork's, fails the operand test
// of try: its type is known and is not an Effect (VIP-17, EK1703).
func forkOperandRejected(c *checker.Checker, operand *ast.Node) bool {
	t := analyzerFor(c).keywordValueType(operand)
	return t != nil && !isEffectOperandType(c, t)
}

// joinsRejectedFork reports whether operand, join's, is a fork whose operand
// EK1703 rejects, or a const bound to one. That fork's call resolves to no
// Fiber (fork job picks Effect.forkScoped's options overload), and EK1703
// already names the mistake, so join reports nothing more.
func (a *analyzer) joinsRejectedFork(operand *ast.Node) bool {
	c := a.checker
	expr := ast.SkipParentheses(operand)
	if ast.IsIdentifier(expr) {
		symbol := c.GetSymbolAtLocation(expr)
		if symbol == nil || symbol.ValueDeclaration() == nil {
			return false
		}
		decl := symbol.ValueDeclaration()
		if !ast.IsVariableDeclaration(decl) || !ast.IsVarConst(decl) || decl.Initializer() == nil {
			return false
		}
		expr = ast.SkipParentheses(decl.Initializer())
	}
	if !ast.IsCallExpression(expr) || len(expr.Arguments()) != 1 || a.keywordFork(expr.Arguments()[0]) == nil || !inEffectCode(expr) {
		return false
	}
	return forkOperandRejected(c, expr.Arguments()[0])
}

// checkForkOperand reports operand, fork's, when its type is not an Effect,
// the operand test of try (VIP-17, VIP-5).
func checkForkOperand(c *checker.Checker, file *ast.SourceFile, operand *ast.Node) {
	inner := ast.SkipParentheses(operand)
	if ast.NodeIsMissing(inner) {
		return
	}
	if !forkOperandRejected(c, operand) {
		return
	}
	t := analyzerFor(c).keywordValueType(operand)
	text := shortText(nodeText(file, inner), "this operand")
	d := reportAt(c, file, core.NewTextRange(nodeStart(file, operand), operand.End()), EK1703, text, c.TypeToString(t))
	switch {
	case ast.IsFunctionExpressionOrArrowFunction(inner):
		note(d, "Fork an effect block instead: fork effect { ... }.")
		note(d, "Through VibeLang 0.0.10, fork ran the function's body: write that body as the operand.")
	case len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) > 0:
		note(d, "Call it to fork the Effect it returns: fork {0}().", text)
	default:
		note(d, "Fork an Effect, such as fork Effect.succeed({0}).", text)
	}
}

// filterRejectedForkArgumentDiagnostics lets EK1703 explain the generated
// fork helper's argument mismatch, including errors elaborated at object
// properties. The checker supplies only that call's applicability diagnostics;
// errors in written calls, assignments and satisfies expressions stay intact.
func filterRejectedForkArgumentDiagnostics(c *checker.Checker, call *ast.Node, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	if len(diagnostics) == 0 || !ast.IsCallExpression(call) || !isVibeLangFile(ast.GetSourceFileOfNode(call)) {
		return diagnostics
	}
	if isForkOwner(call) && inEffectCode(call) {
		if forkOwnerRejected(c, call) {
			return nil
		}
		return diagnostics
	}
	if len(call.Arguments()) != 1 {
		return diagnostics
	}
	// Placement explains only the generated operator call. Inner source
	// calls, constraints and assignments retain their own diagnostics.
	if isFiberOperator(call) && !inEffectCode(call) {
		return nil
	}
	if inHatch(call) || !inEffectCode(call) {
		return diagnostics
	}
	operand := call.Arguments()[0]
	if analyzerFor(c).keywordFork(operand) != nil && forkOperandRejected(c, operand) {
		return nil
	}
	return diagnostics
}
