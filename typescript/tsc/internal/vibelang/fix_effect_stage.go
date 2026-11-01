package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// vibelang --fix writes the last stage of a pipeline, and a program built from
// a thunk, in the forms VibeLang has for them. These are the rewrites a
// migration needs after EK1002's and EK4502's, which leave them as calls:
//
//	try (x |> Effect.orElseSucceed(%, () => v))   x catch () => v
//	try (x |> Effect.mapError(%, (e) => f(e)))    x catch effect (e) => { throw f(e) }
//	try (x catch (e) => v)                        x catch (e) => v
//	try x catch (e) => v                          x catch (e) => v
//	Effect.sync(() => v)                          effect { return v }
//	Effect.sync(() => { B })                      effect { B }
//	Effect.suspend(() => p)                       effect { return try p }
//	try Effect.sync(() => v)                      v
//	try Effect.suspend(() => p)                   try p
//	(a) => Effect.sync(() => v)                   effect (a) => v
//	(a) => Effect.sync(() => { B })               effect (a) => { B }
//
// A stage rewrites only where its pipeline runs: under try, or as what a
// function returns. A catch expression runs its left side, so a pipeline held
// as a value stays one, and so does a stage with stages after it, which take
// the program. The handler keeps its parameter and its text. A thunk that
// throws, awaits, or reads this or arguments means something else in a block,
// and an Effect.sync whose value is itself a program would run it, so those
// stay. The vibelang --fix gate (fix.go) refuses any rewrite that adds an
// error. These rewrites report nothing: they are --fix's, and the calls they
// replace are correct VibeLang.

// stagePipe returns the pipe whose last stage call is, with the topic as its
// first argument and nowhere else, or nil.
func stagePipe(call *ast.Node) *ast.Node {
	arguments := call.Arguments()
	if len(arguments) == 0 || !isTopic(arguments[0]) || !isPipe(call.Parent) || call.Parent.AsBinaryExpression().Right != call {
		return nil
	}
	pipe := call.Parent
	top := pipe
	for ast.IsParenthesizedExpression(top.Parent) {
		top = top.Parent
	}
	if pipeOfLeft(top) != nil {
		return nil
	}
	var topicAgain func(node *ast.Node) bool
	topicAgain = func(node *ast.Node) bool {
		return isTopic(node) && pipeOfTopic(node) == pipe || node.ForEachChild(topicAgain)
	}
	if slices.ContainsFunc(arguments[1:], topicAgain) {
		return nil
	}
	return pipe
}

// runningSite returns the expression that stands for node where node runs:
// the try around it, or node itself as what a function returns. It returns nil
// where node is a value.
func runningSite(node *ast.Node) *ast.Node {
	top := node
	for ast.IsParenthesizedExpression(top.Parent) {
		top = top.Parent
		if top.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return top
		}
	}
	parent := top.Parent
	switch {
	case isTryCall(parent):
		return parent
	case isSynthesizedPosition(parent):
		return nil
	case ast.IsReturnStatement(parent), ast.IsArrowFunction(parent) && parent.Body() == top:
		return top
	}
	return nil
}

// catchLeftText returns the text of left as a catch expression's left side.
func catchLeftText(file *ast.SourceFile, left *ast.Node) string {
	text := expressionText(file, left)
	if isLowPrecedence(left) {
		return "(" + text + ")"
	}
	return text
}

// stageRewrite plans the rewrite of pipe, whose last stage is an
// Effect.orElseSucceed or an Effect.mapError, or nil.
func stageRewrite(c *checker.Checker, file *ast.SourceFile, pipe *ast.Node) *formRewrite {
	call := pipe.AsBinaryExpression().Right
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || ast.IsOptionalChain(call) || len(call.Arguments()) != 2 ||
		!isEffectFunction(c, call.Expression(), "Effect", "orElseSucceed", "mapError") || stagePipe(call) != pipe || !inLowerableBody(call) {
		return nil
	}
	site := runningSite(pipe)
	if site == nil {
		return nil
	}
	left := catchLeftText(file, pipe.AsBinaryExpression().Left)
	argument := call.Arguments()[1]
	handler, literal := catchHandlerOf(argument)
	var text string
	if _, name := effectMember(c, call.Expression()); name == "orElseSucceed" {
		if !literal || handler.parameter != "" || isProgram(c, handler.value) {
			return nil
		}
		value := expressionText(file, handler.value)
		if strings.HasPrefix(value, "{") {
			value = "(" + value + ")"
		}
		text = left + " catch () => " + value
	} else {
		switch {
		case literal:
			text = left + " catch effect (" + handler.parameter + ") => { throw " + expressionText(file, handler.value) + " }"
		case ast.IsIdentifier(argument) || ast.IsPropertyAccessExpression(argument):
			text = left + " catch effect (e) => { throw " + expressionText(file, argument) + "(e) }"
		default:
			return nil
		}
	}
	return siteRewrite(c, file, site, text, "a catch expression")
}

// triedCatchRewrite plans the removal of the try around a catch expression,
// which runs what it stands for already, or nil.
func triedCatchRewrite(c *checker.Checker, file *ast.SourceFile, site *ast.Node) *formRewrite {
	var catch *ast.Node
	switch {
	case isTryCall(site):
		catch = ast.SkipParentheses(tryOperand(site))
	case ast.IsParenthesizedExpression(site) && site.Flags&ast.NodeFlagsVibeLangTry != 0:
		catch = ast.SkipParentheses(site)
	}
	if catch == nil || catchExpressionOf(catch) == nil {
		return nil
	}
	handler := ast.SkipParentheses(catch.Arguments()[1])
	if !ast.IsArrowFunction(handler) || handler.Flags&ast.NodeFlagsVibeLangEffect == 0 && isProgram(c, handler.Body()) {
		return nil
	}
	return siteRewrite(c, file, site, expressionText(file, catch), "the catch expression alone")
}

// triedLeftRewrite plans the removal of the try before the left side of a
// catch, which runs that side, or nil.
func triedLeftRewrite(file *ast.SourceFile, catch *ast.Node) *formRewrite {
	left := ast.SkipParentheses(catch.Arguments()[0])
	if !ast.IsArrowFunction(left) || left.Body().Flags&ast.NodeFlagsVibeLangTry == 0 {
		return nil
	}
	keyword := tryKeyword(file, left.Body())
	end := keyword.End()
	for end < len(file.Text()) && file.Text()[end] == ' ' {
		end++
	}
	return &formRewrite{edits: []sourceEdit{{keyword.Pos(), end, ""}}, description: "the catch expression alone"}
}

// siteRewrite replaces site with text, parenthesized where site's position
// needs it.
func siteRewrite(c *checker.Checker, file *ast.SourceFile, site *ast.Node, text, description string) *formRewrite {
	if catchNeedsParentheses(site) {
		text = "(" + text + ")"
	}
	return withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{nodeStart(file, site), site.End(), text}}, description: description})
}

// isProgram reports whether node is a program: an Effect, or a call of one,
// whose type in a function that runs it is its success value.
func isProgram(c *checker.Checker, node *ast.Node) bool {
	t := c.GetTypeAtLocation(node)
	return isEffectType(c, t) || isEffectValueType(c, t) || isInvocation(ast.SkipParentheses(node)) && callReturnsEffect(c, ast.SkipParentheses(node))
}

// thunkValue returns what arrow, a thunk, computes: its expression, or the
// expression its one return statement gives. For another block it returns nil.
func thunkValue(arrow *ast.Node) *ast.Node {
	body := arrow.Body()
	if !ast.IsBlock(body) {
		return body
	}
	statements := body.Statements()
	if len(statements) == 1 && ast.IsReturnStatement(statements[0]) && statements[0].Expression() != nil {
		return statements[0].Expression()
	}
	return nil
}

// thunkMovesToBlock reports whether body, a thunk's, means the same in an
// effect block: a throw is a defect in a thunk and a failure in a block, effect
// code has no try statements, and await, yield, this and arguments belong to
// the function around them.
func thunkMovesToBlock(body *ast.Node) bool {
	var stays func(node *ast.Node) bool
	stays = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindThrowStatement, ast.KindTryStatement, ast.KindAwaitExpression, ast.KindYieldExpression, ast.KindThisKeyword:
			return true
		case ast.KindIdentifier:
			if node.Text() == "arguments" {
				return true
			}
		case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindClassDeclaration, ast.KindClassExpression:
			return false
		}
		return node.ForEachChild(stays)
	}
	return !stays(body)
}

// thunkRewrite plans the rewrite of call, an Effect.sync or an Effect.suspend
// of a thunk, or nil.
func thunkRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || ast.IsOptionalChain(call) || len(call.Arguments()) != 1 ||
		!isEffectFunction(c, call.Expression(), "Effect", "sync", "suspend") {
		return nil
	}
	arrow := ast.SkipParentheses(call.Arguments()[0])
	if !ast.IsArrowFunction(arrow) || arrow.Flags&ast.NodeFlagsVibeLangEffect != 0 || ast.HasSyntacticModifier(arrow, ast.ModifierFlagsAsync) ||
		len(arrow.Parameters()) > 0 || arrow.TypeParameters() != nil || arrow.Type() != nil || !thunkMovesToBlock(arrow.Body()) {
		return nil
	}
	_, name := effectMember(c, call.Expression())
	value := thunkValue(arrow)
	if value == nil && name == "suspend" {
		return nil
	}
	if value != nil {
		if isProgram(c, value) != (name == "suspend") {
			return nil
		}
	}
	site, runs := call, call.Flags&ast.NodeFlagsVibeLangTry != 0
	for n := call; !runs && ast.IsParenthesizedExpression(n.Parent); n = n.Parent {
		if n.Parent.Flags&ast.NodeFlagsVibeLangTry != 0 {
			site, runs = n.Parent, true
		}
	}
	// What a value writes where it stands, and where a block holds it.
	var direct, block string
	switch {
	case value == nil:
		block = "effect " + file.Text()[nodeStart(file, arrow.Body()):arrow.Body().End()]
	case name == "sync":
		direct = expressionText(file, value)
		block = "effect { return " + direct + " }"
	default:
		operand := expressionText(file, value)
		if needsOperandParentheses(value) {
			operand = "(" + operand + ")"
		}
		direct = "try " + operand
		block = "effect { return " + direct + " }"
	}
	text := block
	var edits []sourceEdit
	parent := call.Parent
	tail := ast.IsArrowFunction(parent) && parent.Body() == call && !isSynthesizedPosition(parent) && isLowerable(parent) && (parent.Type() == nil || analyzerFor(c).hasContract(parent))
	switch {
	case ast.IsReturnStatement(parent) && !runs:
		return nil // the function around it holds the program: its own fix says how
	case runs && value == nil:
		text = "try " + block
	case runs:
		text = direct
		if isLowPrecedence(value) && name == "sync" && catchNeedsParentheses(site) {
			text = "(" + text + ")"
		}
	case tail:
		text = direct
		if value == nil {
			text = strings.TrimPrefix(block, "effect ") // the function takes the thunk's body
		} else if strings.HasPrefix(text, "{") {
			text = "(" + text + ")"
		}
		if parent.Type() == nil && parent.Flags&ast.NodeFlagsVibeLangEffect == 0 {
			start := nodeStart(file, parent)
			edits = append(edits, sourceEdit{start, start, "effect "})
		}
	}
	edits = append(edits, sourceEdit{nodeStart(file, site), site.End(), text})
	return withImportRemovals(c, file, &formRewrite{edits: edits, description: "an effect block"})
}

// effectStageFixes proposes the rewrites of file above, taking each that
// overlaps none taken before it; the next round takes the rest.
func effectStageFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	p := proposal{file: file}
	var taken []sourceEdit
	propose := func(code int32, node *ast.Node, rewrite *formRewrite) {
		key := "effectStage:" + expressionText(file, node)
		if !rewrite.fixable() || refused[key] || !editsPreserveComments(file.Text(), rewrite.edits) ||
			slices.ContainsFunc(rewrite.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			return
		}
		taken = append(taken, rewrite.edits...)
		p.fixes = append(p.fixes, fileFix{code: code, edits: rewrite.edits, key: key})
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isPipe(node):
			propose(EK4835.Code, node, stageRewrite(c, file, node))
		case ast.IsParenthesizedExpression(node), isTryCall(node):
			propose(EK4835.Code, node, triedCatchRewrite(c, file, node))
		case catchExpressionOf(node) != nil:
			propose(EK4835.Code, node, triedLeftRewrite(file, node))
		case ast.IsCallExpression(node):
			propose(EK4834.Code, node, thunkRewrite(c, file, node))
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return p
}
