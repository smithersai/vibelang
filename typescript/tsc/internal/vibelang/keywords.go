package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
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
// fork(e) is the keyword while its callee, spelled fork, resolves to the
// prelude's binding; a fork the program declares is an ordinary call, never
// decided by spelling (rule H5). Typing, flow, hover and lowering ask
// keywordOperand whether an operand runs where it stands, never the
// destination's type: D147's type-chosen deferral no longer reaches these
// operands, so a plain call such as events.push("x") runs in the new fiber
// too. The operand's program succeeds with the operand's value, which is
// never run again: an operand whose value is itself a program is EK4613,
// and an await element that is a fiber or a Deferred is EK4609 or EK4610
// (D394, D433). For such an operand, which no compiling program has, the
// compiler keeps the reading its repair gives, so the error stands alone.

// EK4613: a keyword operand whose own type is a program (D394, D433). {0} is the operand, {1} what would give it back.
var EK4613 = message(4613, errorCategory, "{0} is a program, so {1} would give it back unrun.")

func init() {
	registry[EK4613.Code] = EK4613
	fileChecks = append(fileChecks, checkKeywordOperands)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4613.Code, EK4609.Code, EK4610.Code}, GetCodeActions: keywordOperandActions})
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
// a program, which EK4613 reports, and it keeps the form its destination
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
	if call := awaitLiteralOperation(outer); call != nil {
		return call
	}
	return a.keywordFork(outer)
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
	if call := a.keywordFormOf(node); !a.resolving[call] {
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
	return a.checker.NewTypeReference(effect, []*checker.Type{success, a.checker.GetUnionType(info.errors), a.checker.GetUnionType(info.requirements)})
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
	s := a.conversions[node]
	if s == nil {
		s = &valueState{byCandidate: map[candidateKey]conversion{}, types: map[candidateKey]*checker.Type{}}
		a.conversions[node] = s
	}
	s.first, s.checked = convertByName, true
	if signature := a.candidateOf(call); signature != nil {
		s.byCandidate[keyOf(signature)] = convertByName
	}
	for _, candidate := range a.current[call] {
		s.byCandidate[keyOf(candidate)] = convertByName
	}
	return program, true
}

// keywordValueType returns the value type of node, a keyword operand, as its
// form's check left it, or its type when no check recorded one.
func (a *analyzer) keywordValueType(node *ast.Node) *checker.Type {
	if call := a.keywordFormOf(node); call != nil && a.keywordValues[node] == nil && !a.resolving[call] {
		a.checker.GetResolvedSignature(call)
	}
	if value := a.keywordValues[node]; value != nil {
		return value
	}
	return a.checker.GetTypeAtLocation(node)
}

// forEachKeywordOperand calls visit with each operand of call, a fork or an
// await operation with a literal operand, as written with its parentheses.
func forEachKeywordOperand(call *ast.Node, visit func(operand *ast.Node)) {
	arguments := call.Arguments()
	if len(arguments) != 1 {
		return
	}
	if awaitOperationNames[fiberHelper(call)] == "" {
		visit(arguments[0])
		return
	}
	switch literal := ast.SkipParentheses(arguments[0]); literal.Kind {
	case ast.KindArrayLiteralExpression:
		for _, element := range literal.AsArrayLiteralExpression().Elements.Nodes {
			if !ast.IsSpreadElement(element) && element.Kind != ast.KindOmittedExpression {
				visit(element)
			}
		}
	case ast.KindObjectLiteralExpression:
		for _, property := range literal.AsObjectLiteralExpression().Properties.Nodes {
			switch {
			case ast.IsPropertyAssignment(property):
				visit(property.Initializer())
			case ast.IsShorthandPropertyAssignment(property):
				visit(property.Name())
			}
		}
	}
}

// keywordWhat names what would give back an operand of call unrun.
func keywordWhat(call *ast.Node) string {
	if name := awaitOperationNames[fiberHelper(call)]; name != "" {
		return name
	}
	return "fork's new fiber"
}

// checkKeywordOperands validates fork operands. Retired await operations
// keep only their old typing recorder for --fix; EK1802 rejects the syntax.
func checkKeywordOperands(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindModuleDeclaration || awaitOperationNames[fiberHelper(node)] != "" {
			return false
		}
		if ast.IsCallExpression(node) && !inHatch(node) && len(node.Arguments()) == 1 && a.keywordFork(node.Arguments()[0]) != nil {
			a.checkKeywordOperand(file, node, node.Arguments()[0])
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkKeywordOperand reports operand, an operand of call as written, when
// its value is a program, or, as an await element, a fiber or a Deferred.
func (a *analyzer) checkKeywordOperand(file *ast.SourceFile, call *ast.Node, operand *ast.Node) {
	c := a.checker
	inner := ast.SkipParentheses(operand)
	if ast.NodeIsMissing(inner) {
		return
	}
	rewrite := keywordOperandRewrite(c, file, call, operand)
	var d *ast.Diagnostic
	span := core.NewTextRange(nodeStart(file, operand), operand.End())
	switch {
	case isForkBlock(inner):
		return // fork { … }: the block is the program
	case ast.IsFunctionExpressionOrArrowFunction(inner):
		if requiredParameterCount(inner) == 0 {
			d = reportAt(c, file, span, EK4613, "This function", keywordWhat(call))
		}
	default:
		value := a.keywordValueType(inner)
		switch {
		case value == nil:
		case a.isProgramValueType(value):
			d = reportAt(c, file, span, EK4613, messageText(inner, "This operand"), keywordWhat(call))
		}
	}
	if d != nil {
		if rewrite.fixable() {
			note(d, "Write {0}.", rewrite.description)
		} else if rewrite != nil && rewrite.why != "" {
			note(d, "{0}", rewrite.why)
		}
		coverArgument(c, operand)
	}
	if reading := a.legacyKeywordReading(call, operand); reading.change != keywordUnchanged {
		reportKeywordMigration(c, file, legacyKeywordSite{call, operand, reading}, d)
	}
}

// keywordOperandActions offers the repair of an EK4613, EK4609, or EK4610
// at a keyword operand.
func keywordOperandActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	a := analyzerFor(c)
	var actions []*ls.CodeAction
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.End() < fix.Span.Pos() || node.Pos() > fix.Span.End() {
			return false
		}
		if ast.IsCallExpression(node) && (awaitOperationNames[fiberHelper(node)] != "" || len(node.Arguments()) == 1 && a.keywordFork(node.Arguments()[0]) != nil) {
			forEachKeywordOperand(node, func(operand *ast.Node) {
				if nodeStart(fix.SourceFile, operand) != fix.Span.Pos() {
					return
				}
				if r := keywordOperandRewrite(c, fix.SourceFile, node, operand); r.fixable() {
					e := r.edits[0]
					actions = append(actions, &ls.CodeAction{Description: "Write " + r.description, Changes: replaceRange(fix, e.start, e.end, e.text)})
				}
			})
		}
		return node.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	return actions, nil
}

// keywordOperandRewrite plans the repair of operand, an operand of call as
// written, that keeps what the operand meant through VibeLang 0.0.10, when
// the operation ran a program operand and waited for a fiber or a Deferred:
// a function literal's body becomes the operand (fork heartbeat(), fork { … },
// or a do { … } element), a program value is called (fork job(), job()), a
// fiber is joined (join f), and a Deferred is awaited (d.await()). It returns
// nil for an operand that needs no repair.
func keywordOperandRewrite(c *checker.Checker, file *ast.SourceFile, call, operand *ast.Node) *formRewrite {
	a := analyzerFor(c)
	inner := ast.SkipParentheses(operand)
	fork := awaitOperationNames[fiberHelper(call)] == ""
	refuse := func(why string) *formRewrite { return &formRewrite{why: why} }
	write := func(start, end int, text, description string) *formRewrite {
		return &formRewrite{edits: []sourceEdit{{start, end, text}}, description: shortDescription(text, description)}
	}
	if ast.IsFunctionExpressionOrArrowFunction(inner) && !isForkBlock(inner) {
		if !ast.IsArrowFunction(inner) || len(inner.Parameters()) != 0 || inner.TypeParameters() != nil || inner.Type() != nil {
			return refuse("Only an arrow with no parameters and no annotation has a body to write in its place; write the operand's body yourself.")
		}
		body := inner.Body()
		if fork {
			if body.Kind == ast.KindBlock {
				text := "fork " + expressionText(file, body)
				if !unaryFits(call) {
					text = "(" + text + ")"
				}
				return write(nodeStart(file, call), call.End(), text, "fork { … }")
			}
			if unaryFits(call) && startsForkOperand(body) {
				return write(nodeStart(file, call), call.End(), "fork "+expressionText(file, body), "fork with the arrow's body")
			}
			return write(nodeStart(file, operand), operand.End(), expressionText(file, body), "the arrow's body as fork's operand")
		}
		if body.Kind != ast.KindBlock {
			text := expressionText(file, body)
			if ast.IsBinaryExpression(body) && body.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
				text = "(" + text + ")"
			}
			return write(nodeStart(file, operand), operand.End(), text, "the arrow's body as the element")
		}
		text, why := doBlockText(file, body)
		if why != "" {
			return refuse(why)
		}
		return write(nodeStart(file, operand), operand.End(), text, "do { … }")
	}
	value := a.keywordValueType(inner)
	if value == nil {
		return nil
	}
	text := expressionText(file, inner)
	start, end := nodeStart(file, operand), operand.End()
	switch {
	case a.isProgramValueType(value):
		if needsParentheses(inner) {
			text = "(" + text + ")"
		}
		return write(start, end, text+"()", "")
	case fork:
		return nil
	case isFiberType(c, value):
		if needsParentheses(inner) {
			return write(start, end, "join("+text+")", "")
		}
		return write(start, end, "join "+text, "")
	case isDeferredType(c, value):
		if needsParentheses(inner) {
			text = "(" + text + ")"
		}
		return write(start, end, text+".await()", "")
	}
	return nil
}

// shortDescription is text for a note or an action's title, or otherwise
// when text is long or spans lines.
func shortDescription(text, otherwise string) string {
	if otherwise == "" || len(text) <= 40 && !containsLineBreak(text) {
		return text
	}
	return otherwise
}

func containsLineBreak(text string) bool {
	for _, r := range text {
		if r == '\n' || r == '\r' {
			return true
		}
	}
	return false
}

// unaryFits reports whether call, fork(…), can be written fork operand
// where it stands: nothing after it continues it as a call's callee, a
// member's object, or the left side of **, which a unary operand cannot be.
func unaryFits(call *ast.Node) bool {
	parent := outerParentheses(call).Parent
	if parent == nil || outerParentheses(call) != call {
		return true
	}
	switch parent.Kind {
	case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindNonNullExpression,
		ast.KindPostfixUnaryExpression, ast.KindTaggedTemplateExpression:
		return parent.Expression() != call
	case ast.KindCallExpression, ast.KindNewExpression:
		return parent.Expression() != call
	case ast.KindBinaryExpression:
		binary := parent.AsBinaryExpression()
		return binary.OperatorToken.Kind != ast.KindAsteriskAsteriskToken || binary.Left != call
	}
	return true
}

// startsForkOperand reports whether expression can follow the keyword fork
// unparenthesized and stay whole: a name, a member access, a call, new, this,
// or super, which fork's operand starts with and binds as await's does
// (D166).
func startsForkOperand(expression *ast.Node) bool {
	switch expression.Kind {
	case ast.KindIdentifier, ast.KindThisKeyword, ast.KindSuperKeyword, ast.KindNewExpression:
		return true
	case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression, ast.KindNonNullExpression, ast.KindTaggedTemplateExpression:
		head := expression
		for {
			switch head.Kind {
			case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression, ast.KindNonNullExpression:
				head = head.Expression()
				continue
			case ast.KindTaggedTemplateExpression:
				head = head.AsTaggedTemplateExpression().Tag
				continue
			}
			break
		}
		if ast.IsCallExpression(expression) && fiberHelper(expression) != "" {
			return true // await.all […] and the other fiber forms start with a keyword
		}
		return head.Kind == ast.KindIdentifier || head.Kind == ast.KindThisKeyword || head.Kind == ast.KindSuperKeyword || head.Kind == ast.KindNewExpression
	}
	return false
}

// doBlockText writes body, an arrow's block, as a do expression whose value
// is what the arrow returned: its last statement, return e, becomes e. It
// returns why when no do expression means the same: another return, a var
// declaration (EK1019), or a block that does not end in return.
func doBlockText(file *ast.SourceFile, body *ast.Node) (string, string) {
	statements := body.AsBlock().Statements.Nodes
	if len(statements) == 0 {
		return "", "An empty block returns undefined; write the element's value instead."
	}
	last := statements[len(statements)-1]
	if !ast.IsReturnStatement(last) || last.Expression() == nil {
		return "", "A do { … } element's value is its last statement's; end the block with return value, then write it as do { … }."
	}
	why := ""
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isFunctionBoundary(node):
			return false
		case ast.IsReturnStatement(node) && node != last:
			why = "This block returns before its end, which a do { … } element cannot; write the element yourself."
			return true
		case node.Kind == ast.KindVariableDeclarationList && node.Flags&(ast.NodeFlagsLet|ast.NodeFlagsConst|ast.NodeFlagsUsing) == 0:
			why = "A var declaration cannot stand in a do { … } element (EK1019); declare it with let or const."
			return true
		}
		return node.ForEachChild(visit)
	}
	body.ForEachChild(visit)
	if why != "" {
		return "", why
	}
	value := expressionText(file, last.Expression())
	if v := ast.SkipParentheses(last.Expression()); v.Kind == ast.KindObjectLiteralExpression || v.Kind == ast.KindFunctionExpression || v.Kind == ast.KindClassExpression {
		if !ast.IsParenthesizedExpression(last.Expression()) {
			value = "(" + value + ")"
		}
	}
	text := file.Text()
	start := nodeStart(file, last)
	before := text[nodeStart(file, body):start]
	// A value that starts a line with (, [, `, +, -, or / would continue the
	// statement before it, as a call or a tagged template: end that one.
	if strings.ContainsAny(value[:1], "([`+-/") && len(statements) > 1 {
		previous := statements[len(statements)-2]
		if end := previous.End(); !strings.HasSuffix(strings.TrimRight(text[nodeStart(file, previous):end], " \t"), ";") {
			at := end - nodeStart(file, body)
			before = before[:at] + ";" + before[at:]
		}
	}
	return "do " + before + value + text[last.End():body.End()], ""
}
