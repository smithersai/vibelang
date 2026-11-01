package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// EK4835 (D289): Effect's catch combinators that try runs, which a catch
// expression (VIP-5) and a match (VIP-7) write:
//
//	try Effect.catchTag(find(id), "NotFound", (e) => Effect.succeed(`no user ${e.id}`))
//	find(id) catch effect (e) => match (e) { when { _tag: "NotFound" }: `no user ${e.id}`; default: throw e; }
//
//	try Effect.catch(find(id), (e) => Effect.succeed(describe(e)))
//	find(id) catch (e) => describe(e)
//
//	try Effect.catch(find(id), (e) => recover(e))
//	find(id) catch effect (e) => try recover(e)
//
// A catch expression runs its left side, so a combinator no try runs builds a
// program and stays. Effect.catchTag(self, "Tag", handler) and
// Effect.catchTags(self, { Tag: handler, … }) become one arm per tag and
// rethrow only unhandled failures. An arm tests the failure's _tag with an
// object pattern, { _tag: "Tag" }, which is what catchTag tests. Static class
// types are structural and do not prove a runtime prototype.
// Effect.catch(self, handler) becomes the catch expression with the handler.
// A handler must be an arrow function with at most one plain parameter and an
// expression body, or a block that only returns one; the catch expression's
// variable takes its parameter's name. A handler returns an Effect: of
// Effect.succeed(v) its value is v, of Effect.fail(x) a throw, and of any other
// Effect a try. A plain handler holds only values; a throw or a try needs an
// effect handler, in which throw fails again, typed (VIP-5). Every failure in
// the program's E must have a literal _tag for catchTag and catchTags, so that
// the match removes exactly the failures catchTag would. One difference is
// VibeLang's by design (D13, D236): a cause that mixes an expected failure with
// a defect or an interruption passes through a catch expression, while
// Effect's combinators recover from the failure and drop the rest. The last
// stage of a pipeline that try runs, try (x |> Effect.catch(%, h)), is the same
// catch expression. Refused: the data-last forms inside pipe, a stage with
// stages after it, type arguments, a tag that is not a string literal, and
// anything outside a function body.

// catchHandlerMessage is EK4835's text for Effect.catch, whose handler the
// catch expression keeps.
var catchHandlerMessage = EK4835.With("{0} takes a handler; write a catch expression: x catch (e) => handler.")

func init() {
	tsFormRules[EK4835.Code] = &tsFormRule{
		message:   EK4835,
		find:      findCatchCombinators,
		plan:      catchCombinatorRewrite,
		diagnosed: ast.IsCallExpression,
	}
}

// catchCombinatorOf returns the name of the Effect catch combinator that call
// calls in its data-first form, or "".
// methodCatchParts accepts x.pipe(op), one Effect catch operator on x, an Effect.
// A pipeline of several operators keeps its form.
func methodCatchParts(c *checker.Checker, call *ast.Node) (*ast.Node, *ast.Node) {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || ast.IsOptionalChain(call) || len(call.Arguments()) != 1 {
		return nil, nil
	}
	access := call.Expression()
	if !ast.IsPropertyAccessExpression(access) || ast.IsOptionalChain(access) || access.Name().Text() != "pipe" {
		return nil, nil
	}
	self := ast.SkipParentheses(access.Expression())
	operator := ast.SkipParentheses(call.Arguments()[0])
	if !isEffectType(c, c.GetTypeAtLocation(self)) || !ast.IsCallExpression(operator) || operator.TypeArguments() != nil || ast.IsOptionalChain(operator) {
		return nil, nil
	}
	return self, operator
}

func catchCombinatorOf(c *checker.Checker, call *ast.Node) string {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || !inLowerableBody(call) || inHatch(call) || ast.IsOptionalChain(call) {
		return ""
	}
	operator := call
	count := len(call.Arguments())
	if self, inner := methodCatchParts(c, call); self != nil {
		operator, count = inner, len(inner.Arguments())+1
	}
	for _, argument := range operator.Arguments() {
		if ast.IsSpreadElement(argument) {
			return ""
		}
	}
	if !isEffectFunction(c, operator.Expression(), "Effect", "catchTag", "catchTags", "catch") {
		return ""
	}
	_, name := effectMember(c, operator.Expression())
	switch {
	case name == "catchTag" && count == 3, name == "catchTags" && count == 2, name == "catch" && count == 2:
		return name
	}
	return ""
}

// findCatchCombinators reports EK4835 at each catch combinator of file that a
// catch expression writes.
func findCatchCombinators(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := catchCombinatorOf(c, node); name != "" {
			if rewrite := catchCombinatorRewrite(c, file, node); rewrite.fixable() {
				report(node, rewrite, "Effect."+name)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// catchHandler is a handler's parameter name, or "", and its value.
type catchHandler struct {
	parameter string
	binding   *ast.Node
	value     *ast.Node
}

// catchHandlerOf returns handler's parts when it is an arrow function with
// at most one identifier parameter and a body that is one value.
func catchHandlerOf(handler *ast.Node) (catchHandler, bool) {
	handler = ast.SkipParentheses(handler)
	if !ast.IsArrowFunction(handler) || ast.HasSyntacticModifier(handler, ast.ModifierFlagsAsync) || handler.TypeParameters() != nil || handler.Type() != nil {
		return catchHandler{}, false
	}
	parameters := handler.Parameters()
	result := catchHandler{}
	switch len(parameters) {
	case 0:
	case 1:
		p := parameters[0]
		if !ast.IsIdentifier(p.Name()) || p.Type() != nil || p.Initializer() != nil || p.AsParameterDeclaration().DotDotDotToken != nil {
			return catchHandler{}, false
		}
		result.parameter = p.Name().Text()
		result.binding = p.Name()
	default:
		return catchHandler{}, false
	}
	body := handler.Body()
	if ast.IsBlock(body) {
		statements := body.Statements()
		if len(statements) != 1 || !ast.IsReturnStatement(statements[0]) || statements[0].Expression() == nil {
			return catchHandler{}, false
		}
		body = statements[0].Expression()
	}
	result.value = body
	return result, true
}

// catchCombinatorRewrite plans EK4835's fix for call.
func catchCombinatorRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	name := catchCombinatorOf(c, call)
	if name == "" {
		return nil
	}
	arguments := call.Arguments()
	if self, inner := methodCatchParts(c, call); self != nil {
		arguments = append([]*ast.Node{self}, inner.Arguments()...)
	}
	// The site is what the catch expression replaces: call, or for the last
	// stage of a pipeline that try runs, the try and the pipeline.
	site := call
	var left string
	if isTopic(arguments[0]) {
		pipe := stagePipe(call)
		if pipe == nil {
			return nil
		}
		if site = runningSite(pipe); site == nil {
			return nil
		}
		self := pipe.AsBinaryExpression().Left
		if !isEffectType(c, c.GetTypeAtLocation(self)) {
			return nil
		}
		left = catchLeftText(file, self)
	} else {
		if !analyzerFor(c).runs(call) {
			return nil
		}
		self := arguments[0]
		if !isEffectType(c, c.GetTypeAtLocation(self)) {
			return nil
		}
		left = expressionText(file, self)
		if needsOperandParentheses(self) && isInvocation(ast.SkipParentheses(self)) || isHelperCall(self) || isLowPrecedence(self) || isTry(self) {
			left = "(" + left + ")"
		}
	}
	var handlers []catchHandler
	var tags []string
	switch name {
	case "catch":
		handler, ok := catchHandlerOf(arguments[1])
		if !ok {
			return nil
		}
		handlers = append(handlers, handler)
	case "catchTag":
		if !ast.IsStringLiteralLike(arguments[1]) {
			return nil
		}
		handler, ok := catchHandlerOf(arguments[2])
		if !ok {
			return nil
		}
		tags, handlers = append(tags, arguments[1].Text()), append(handlers, handler)
	case "catchTags":
		if !ast.IsObjectLiteralExpression(arguments[1]) {
			return nil
		}
		for _, property := range arguments[1].AsObjectLiteralExpression().Properties.Nodes {
			if !ast.IsPropertyAssignment(property) || !ast.IsIdentifier(property.Name()) && !ast.IsStringLiteral(property.Name()) {
				return nil
			}
			handler, ok := catchHandlerOf(property.Initializer())
			if !ok {
				return nil
			}
			tags, handlers = append(tags, property.Name().Text()), append(handlers, handler)
		}
		if len(tags) == 0 {
			return nil
		}
	}
	// Reuse a shared parameter only when it cannot capture another handler's
	// free name. Otherwise choose a name absent from every handler's scopes
	// and alpha-rename references by symbol, preserving nested bindings.
	variable := ""
	fresh := false
	for _, h := range handlers {
		switch {
		case h.parameter == "":
		case variable == "":
			variable = h.parameter
		case variable != h.parameter:
			fresh = true
		}
	}
	for _, h := range handlers {
		if h.parameter == "" && containsIdentifier(h.value, variable) {
			fresh = true
		}
	}
	if variable == "" || fresh {
		variable = freshCatchName(handlers)
	}
	values := make([]string, len(handlers))
	effectHandler := false
	for i, h := range handlers {
		value, plain, ok := catchArmValue(c, file, h, variable)
		if !ok {
			return nil
		}
		effectHandler = effectHandler || !plain
		values[i] = value
	}
	var text string
	if name == "catch" {
		parameter := variable
		if handlers[0].parameter == "" {
			parameter = "" // a handler that ignores the failure (VIP-5)
		}
		text = left + " catch " + core.IfElse(effectHandler, "effect ", "") + "(" + parameter + ") => " + values[0]
	} else {
		failures := catchFailures(c, call)
		if failures == nil {
			return nil
		}
		var arms []string
		for i, tag := range tags {
			pattern, ok := catchPattern(c, failures, tag)
			if !ok {
				return nil
			}
			arms = append(arms, "when "+pattern+": "+values[i]+";")
		}
		unhandled := slices.ContainsFunc(failures, func(failure *checker.Type) bool {
			literal := c.GetTypeOfPropertyOfType(failure, "_tag")
			return literal == nil || !literal.IsStringLiteral() || !slices.ContainsFunc(tags, func(tag string) bool {
				return literal.AsLiteralType().Value() == tag
			})
		})
		if unhandled {
			arms = append(arms, "default: throw "+variable+";")
			effectHandler = true // a plain handler's throw would be a defect (VIP-5)
		}
		head := left + " catch " + core.IfElse(effectHandler, "effect ", "") + "(" + variable + ") => match (" + variable + ") {"
		text = head + " " + strings.Join(arms, " ") + " }"
		if len(text) > 100 || strings.ContainsAny(expressionText(file, site), "\r\n") {
			// One arm per line, as a match is written when it does not fit one.
			indent := lineIndent(file.Text(), nodeStart(file, site))
			text = head + "\n" + indent + "  " + strings.Join(arms, "\n"+indent+"  ") + "\n" + indent + "}"
		}
	}
	if catchNeedsParentheses(site) {
		text = "(" + text + ")"
	}
	start := nodeStart(file, site)
	if site != call && site.Flags&ast.NodeFlagsVibeLangTry != 0 {
		start = tryKeyword(file, site).Pos() // a catch expression runs its left side
	}
	rewrite := withImportRemovals(c, file, &formRewrite{
		edits:       []sourceEdit{{start, site.End(), text}},
		description: shortText(text, "a catch expression"),
	})
	if name == "catch" {
		rewrite.message = catchHandlerMessage
	}
	return rewrite
}

// catchArmValue returns what handler's Effect gives, as a catch handler's
// value, and whether a plain handler can hold it: the value of Effect.succeed,
// a throw of Effect.fail's argument, and a try of any other Effect.
func catchArmValue(c *checker.Checker, file *ast.SourceFile, handler catchHandler, variable string) (string, bool, bool) {
	node := handler.value
	if !isEffectType(c, c.GetTypeAtLocation(node)) {
		return "", false, false // not a handler for a combinator that needs an Effect
	}
	callee := ""
	if ast.IsCallExpression(node) && node.TypeArguments() == nil && !ast.IsOptionalChain(node) && len(node.Arguments()) == 1 && !ast.IsSpreadElement(node.Arguments()[0]) && isEffectFunction(c, node.Expression(), "Effect", "succeed", "fail") {
		_, callee = effectMember(c, node.Expression())
	}
	if callee == "succeed" {
		t := c.GetTypeAtLocation(node.Arguments()[0])
		if isEffectType(c, t) || isEffectValueType(c, t) {
			callee = "" // succeed holds a cold program as data
		}
	}
	if callee != "" {
		node = node.Arguments()[0]
	}
	text, ok := catchValueText(c, file, node, handler, variable)
	if !ok {
		return "", false, false
	}
	switch callee {
	case "succeed":
		if strings.HasPrefix(text, "{") || isLowPrecedence(node) {
			text = "(" + text + ")"
		}
		return text, true, true
	case "fail":
		if needsOperandParentheses(node) {
			text = "(" + text + ")"
		}
		return "throw " + text, false, true
	}
	return tryText(node, text), false, true
}

// catchValueText preserves identifier identity when independent handler scopes
// are merged into one catch. Shorthand keys keep their spelling; only their
// value is renamed. No wrapper is introduced around lexical this or arguments.
func catchValueText(c *checker.Checker, file *ast.SourceFile, value *ast.Node, handler catchHandler, variable string) (string, bool) {
	text := expressionText(file, value)
	if handler.parameter == "" || handler.parameter == variable {
		return text, true
	}
	symbol := c.GetSymbolAtLocation(handler.binding)
	if symbol == nil {
		return "", false
	}
	start := nodeStart(file, value)
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsShorthandPropertyAssignment(node) && c.GetShorthandAssignmentValueSymbol(node) == symbol {
			name := node.Name()
			edits = append(edits, sourceEdit{nodeStart(file, name) - start, name.End() - start, name.Text() + ": " + variable})
			return false
		}
		if ast.IsIdentifier(node) && c.GetSymbolAtLocation(node) == symbol {
			edits = append(edits, sourceEdit{nodeStart(file, node) - start, node.End() - start, variable})
		}
		return node.ForEachChild(visit)
	}
	visit(value)
	return applyEdits(text, edits), true
}

// freshCatchName returns a name for the catch variable that no handler's
// value contains.
func freshCatchName(handlers []catchHandler) string {
	for i := 1; ; i++ {
		name := "e"
		if i > 1 {
			name = "e" + strconv.Itoa(i)
		}
		if !slices.ContainsFunc(handlers, func(h catchHandler) bool { return containsIdentifier(h.value, name) }) {
			return name
		}
	}
}

// containsIdentifier reports whether node holds an identifier written name.
func containsIdentifier(node *ast.Node, name string) bool {
	if ast.IsIdentifier(node) && node.Text() == name {
		return true
	}
	return node.ForEachChild(func(child *ast.Node) bool { return containsIdentifier(child, name) })
}

// catchFailures returns the expected failures of the program call, a catch
// combinator, catches, one type per member, or nil when one has no literal
// _tag. They are the E of its first parameter as the call instantiates it.
func catchFailures(c *checker.Checker, call *ast.Node) []*checker.Type {
	var t *checker.Type
	if self, _ := methodCatchParts(c, call); self != nil {
		t = c.GetTypeAtLocation(self)
	} else {
		signature := c.GetResolvedSignature(call)
		if signature == nil || len(signature.Parameters()) == 0 {
			return nil
		}
		t = c.GetTypeAtPosition(signature, 0)
	}
	if !isEffectType(c, t) {
		return nil
	}
	errors := channelType(c, t, "_E")
	if errors == nil {
		return nil
	}
	var failures []*checker.Type
	for _, member := range errors.Distributed() {
		if member.Flags()&checker.TypeFlagsNever != 0 {
			continue
		}
		tag := c.GetTypeOfPropertyOfType(member, "_tag")
		if tag == nil || !tag.IsStringLiteral() {
			return nil
		}
		failures = append(failures, member)
	}
	return failures
}

// catchPattern keeps catchTag's structural predicate, including for values
// whose static type names an error class but whose prototype does not.
func catchPattern(c *checker.Checker, failures []*checker.Type, tag string) (string, bool) {
	for _, failure := range failures {
		if literal := c.GetTypeOfPropertyOfType(failure, "_tag"); literal != nil && literal.IsStringLiteral() && literal.AsLiteralType().Value() == tag {
			return "{ _tag: " + strconv.Quote(tag) + " }", true
		}
	}
	return "", false
}

// catchNeedsParentheses reports whether a catch expression that replaces call
// needs parentheses: anywhere but a whole expression of its own, since catch
// binds looser than every binary operator and its handler extends as far as
// an arrow function's body does (D237).
func catchNeedsParentheses(call *ast.Node) bool {
	parent := call.Parent
	if isSynthesizedPosition(parent) {
		return true // the left side of another catch expression, or another form the parser wrote
	}
	switch {
	case ast.IsVariableDeclaration(parent) && parent.Initializer() == call,
		ast.IsReturnStatement(parent), ast.IsExpressionStatement(parent),
		ast.IsCallExpression(parent) && parent.Expression() != call && !isHelperCall(parent),
		ast.IsPropertyAssignment(parent) && parent.Initializer() == call,
		ast.IsArrayLiteralExpression(parent), ast.IsTemplateSpan(parent), ast.IsParenthesizedExpression(parent),
		ast.IsArrowFunction(parent) && parent.Body() == call:
		return false
	}
	return true
}
