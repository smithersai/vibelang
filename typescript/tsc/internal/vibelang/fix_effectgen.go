package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK1002's quick fix (D470) writes Effect.gen and Effect.fn programs with
// effect and try, the rewrites a migration from Effect TypeScript makes most
// often:
//
//	Effect.gen(function* () { B })            effect { B }
//	(a) => Effect.gen(function* () { B })     effect (a) => { B }
//	function f(a) { return Effect.gen(…) }    effect function f(a) { B }
//	Effect.fn(function* (a) { B })            effect (a) => { B }
//	Effect.fn("n")(function* (a) { B })       effect (a) => try Effect.withSpan(effect { B }, "n")
//	Effect.fn(function* (a) { B }, stage)     effect (a) => try (effect { B } |> stage(%))
//
// In B, each yield* e becomes what runs e where it stands: try e;
// x for Effect.succeed(x); try e.asEffect() for an Effect.Yieldable that is no
// Effect; throw e for an error or Effect.fail(e) in a statement, and
// try Effect.fail(e) elsewhere. A
// program B holds, const p = load(id), stays a program: const p = effect
// { return try load(id) }. A throw is a JavaScript exception in a generator
// and a defect in Effect, so it becomes return try Effect.die(e).
//
// A parameter that a default or a pattern binds is bound when an Effect.gen
// function is called, so that function stays plain and returns the block:
// ({ id }) => effect { B }. Effect.fn binds its parameters when the
// program runs, as an effect function does. An effect function is untraced:
// Effect.fn's stack frames, which only a failure's trace reads, go, and its
// name stays as the span.
//
// The fix keeps the program's meaning (Chapter 28), so it refuses, with a
// note that says why, a generator whose rewrite would mean something else: a
// call that builds a program the generator neither yields nor holds in a
// const, which would run (rule R); a yield* whose success value is itself a
// program; a callback whose program-building call is not the value it
// returns; a try statement, which catches JavaScript exceptions in a
// generator and is no effect code in VibeLang; this without { self: this }
// in Effect.gen, arguments, new.target, super, and a nested function*.
// What stays type-checks only where the gate of vibelang --fix (fix.go) finds
// no new error.

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1002.Code)
	ls.RegisterCodeFixProvider(effectGenFix)
}

// effectGenFix is EK1002's quick fix.
var effectGenFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1002.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		callee := tsFormNodeAt(fix.SourceFile, fix.Span, isCallee)
		if callee == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		rewrite := planEffectGen(c, fix.SourceFile, generatorCallOf(callee))
		if !rewrite.fixable() {
			return nil, nil
		}
		var changes []*lsproto.TextEdit
		for _, edit := range rewrite.edits {
			changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
		}
		return []*ls.CodeAction{{Description: "Write " + rewrite.description, Changes: changes}}, nil
	},
}

// fixKey names d's fix across the rounds of vibelang --fix (fix.go): its code
// and the text it stands at, which edits elsewhere leave as they are. EK1002
// stands at Effect.gen, which every site shares, so its key holds the call.
func fixKey(file *ast.SourceFile, d *ast.Diagnostic) string {
	span := file.Text()[d.Pos():d.End()]
	if d.Code() == EK1002.Code {
		if callee := tsFormNodeAt(file, core.NewTextRange(d.Pos(), d.End()), isCallee); callee != nil {
			span = nodeText(file, generatorCallOf(callee))
		}
	}
	return diagnosticSource + strconv.Itoa(int(d.Code())) + ":" + span
}

// generatorCallOf returns the call that callee, the API EK1002 names, leads
// to and that passes the generator: Effect.fn("n")(function* …) for the
// Effect.fn of that text.
func generatorCallOf(callee *ast.Node) *ast.Node {
	call := callee.Parent
	for !slices.ContainsFunc(call.Arguments(), isGeneratorExpression) && call.Parent != nil && ast.IsCallExpression(call.Parent) && call.Parent.Expression() == call {
		call = call.Parent
	}
	return call
}

// isGeneratorExpression reports whether node is a function* written in place.
func isGeneratorExpression(node *ast.Node) bool {
	return ast.IsFunctionExpression(node) && node.BodyData().AsteriskToken != nil
}

// isCallee reports whether node is the callee of a call.
func isCallee(node *ast.Node) bool {
	return node.Parent != nil && ast.IsCallExpression(node.Parent) && node.Parent.Expression() == node
}

// noteEffectGenFix adds to d, EK1002 at call, what its quick fix writes, or
// why it does not.
func noteEffectGenFix(c *checker.Checker, file *ast.SourceFile, d *ast.Diagnostic, call *ast.Node) {
	if d == nil {
		return
	}
	rewrite := planEffectGen(c, file, call)
	switch {
	case rewrite.fixable():
		note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", rewrite.description)
	case rewrite != nil && rewrite.why != "":
		note(d, "{0}", rewrite.why)
	}
}

// A generatorCall is an Effect.gen or Effect.fn call, as EK1002's fix reads it.
type generatorCall struct {
	generator  *ast.Node
	isFn       bool        // Effect.fn or Effect.fnUntraced, not Effect.gen
	span       []*ast.Node // Effect.fn("n", options)'s arguments
	stages     []*ast.Node // the stages after an Effect.fn's generator
	module     string      // the text that names Effect at the call
	selfIsThis bool        // Effect.gen({ self: this }, …)
	returns    string      // the Effect type an Effect.fn.Return<A, E, R> annotation names, or ""
}

// readGeneratorCall reads call. It returns nil for a call of another API,
// such as Option.gen, and why it cannot be rewritten as the second result.
func readGeneratorCall(c *checker.Checker, file *ast.SourceFile, call *ast.Node) (*generatorCall, string) {
	if !ast.IsCallExpression(call) {
		return nil, ""
	}
	callee := call.Expression()
	arguments := call.Arguments()
	g := &generatorCall{}
	switch {
	case isEffectFunction(c, callee, "Effect", "gen"):
		if call.TypeArguments() != nil || len(arguments) == 0 || len(arguments) > 2 {
			return g, "the call has type arguments or an unusual argument list"
		}
		g.generator = arguments[len(arguments)-1]
		if len(arguments) == 2 {
			if !isSelfThisOption(arguments[0]) {
				return g, "its self option is not { self: this }"
			}
			g.selfIsThis = true
		}
	case isEffectFunction(c, callee, "Effect", "fn", "fnUntraced"):
		if call.TypeArguments() != nil || len(arguments) == 0 {
			return g, "the call has type arguments"
		}
		g.isFn, g.generator, g.stages = true, arguments[0], arguments[1:]
	case ast.IsCallExpression(callee) && isEffectFunction(c, callee.Expression(), "Effect", "fn"):
		if callee.TypeArguments() != nil || call.TypeArguments() != nil || len(arguments) == 0 || len(callee.Arguments()) == 0 {
			return g, "the call has type arguments"
		}
		g.isFn, g.generator, g.stages, g.span = true, arguments[0], arguments[1:], callee.Arguments()
		callee = callee.Expression()
	default:
		return nil, ""
	}
	if ast.IsPropertyAccessExpression(callee) {
		g.module = nodeText(file, callee.Expression())
	} else {
		g.module = "Effect" // Effect's own function, named by a bare global
	}
	generator := g.generator
	if !isGeneratorExpression(generator) || ast.GetFunctionFlags(generator)&ast.FunctionFlagsAsync != 0 || generator.Body() == nil ||
		!g.isFn && (len(generator.Parameters()) > 0 || generator.TypeParameters() != nil) {
		return g, "its generator is not a function* () { … } written in place"
	}
	if generator.Type() != nil {
		// Effect.fn's generator may say what its function's Effect is:
		// function* (): Effect.fn.Return<A, E, R> is effect (): Effect.Effect<A, E, R>.
		if g.returns = fnReturnEffectType(file, generator.Type()); g.returns == "" || !g.isFn {
			return g, "its generator has a return type other than Effect.fn.Return"
		}
	}
	return g, ""
}

// fnReturnEffectType returns the Effect type that t, a written
// Ns.fn.Return<A, E, R>, names, Ns.Effect<A, E, R>, or "" for another type.
func fnReturnEffectType(file *ast.SourceFile, t *ast.Node) string {
	if !ast.IsTypeReferenceNode(t) || t.TypeArguments() == nil || len(t.TypeArguments()) == 0 || len(t.TypeArguments()) > 3 {
		return ""
	}
	name := t.AsTypeReferenceNode().TypeName
	if !ast.IsQualifiedName(name) || name.AsQualifiedName().Right.Text() != "Return" {
		return ""
	}
	fn := name.AsQualifiedName().Left
	if !ast.IsQualifiedName(fn) || fn.AsQualifiedName().Right.Text() != "fn" || !ast.IsIdentifier(fn.AsQualifiedName().Left) {
		return ""
	}
	var arguments []string
	for _, argument := range t.TypeArguments() {
		arguments = append(arguments, nodeText(file, argument))
	}
	return fn.AsQualifiedName().Left.Text() + ".Effect<" + strings.Join(arguments, ", ") + ">"
}

// planEffectGen plans EK1002's fix for call: the edits, or the note that says
// why there are none. It returns nil for a call of no Effect generator API.
func planEffectGen(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if rewrite := planOptionGen(c, file, call); rewrite != nil {
		return rewrite
	}
	g, why := readGeneratorCall(c, file, call)
	if g == nil {
		return nil
	}
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why + "."}
	}
	if why != "" {
		return refuse(why)
	}
	if why := generatorFiberNameRefusal(c, call); why != "" {
		return refuse(why)
	}
	a := analyzerFor(c)
	text := file.Text()
	generator := g.generator
	block := generator.Body()
	blockStart, blockEnd := nodeStart(file, block), block.End()
	outer := call
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}

	// What the body holds decides whether its rewrite means the same.
	scan := scanEffectGenBody(c, a, file, generator)
	if scan.why != "" {
		return refuse(scan.why)
	}
	if scan.usesThis && !g.isFn && !g.selfIsThis {
		return refuse("the generator reads this, which Effect.gen leaves undefined, but the block would read the function's own this")
	}
	var edits []sourceEdit
	for _, y := range scan.yields {
		edit, why := effectGenTryEdit(c, file, y)
		if why != "" {
			return refuse(why)
		}
		edits = append(edits, edit...)
	}
	// A .pipe in the body changes with it: try f().pipe(g) is EK4502.
	for _, pipe := range scan.pipes {
		if rewrite := planEffectPipe(c, file, pipe); rewrite.fixable() {
			edits = append(edits, rewrite.edits...)
		}
	}
	for _, statement := range scan.throws {
		start := nodeStart(file, statement)
		operand := statement.Expression()
		if hasComment(text[start:nodeStart(file, operand)]) {
			return refuse("a comment stands inside a throw")
		}
		edits = append(edits, sourceEdit{start, nodeStart(file, operand), "return try " + g.module + ".die("}, sourceEdit{operand.End(), operand.End(), ")"})
	}
	for _, held := range scan.held {
		open, close := "effect { return try ", " }"
		if (isPipe(ast.SkipParentheses(held)) || isPipeCall(held)) && !ast.IsParenthesizedExpression(held) {
			open, close = "effect { return try (", ") }"
		}
		start := nodeStart(file, held)
		edits = append(edits, sourceEdit{start, start, open}, sourceEdit{held.End(), held.End(), close})
	}

	opening := nodeStart(file, outer)
	var fn *ast.Node
	parent := outer.Parent
	switch {
	case g.isFn:
	case ast.IsArrowFunction(parent) && parent.Body() == outer:
		fn = parent
	case ast.IsReturnStatement(parent) && ast.IsBlock(parent.Parent) && len(parent.Parent.Statements()) == 1 && isFunctionOfBody(parent.Parent.Parent, parent.Parent):
		fn = parent.Parent.Parent
	}
	bound := fn != nil && slices.ContainsFunc(fn.Parameters(), func(parameter *ast.Node) bool {
		return parameter.Initializer() != nil || ast.IsBindingPattern(parameter.Name())
	})
	if fn != nil && (bound || !isEffectGenFunction(fn)) {
		fn = nil
	}
	if fn != nil {
		opening = nodeStart(file, fn.Body())
		if ast.IsArrowFunction(fn) {
			opening = fn.AsArrowFunction().EqualsGreaterThanToken.End()
		}
	}
	// Only the call, its generator's head, a return and the braces stand
	// outside the generator's block: a comment there would have no place.
	start, end := nodeStart(file, outer), outer.End()
	if fn != nil {
		start, end = opening, fn.Body().End()
	}
	if hasComment(text[start:blockStart]) || hasComment(text[blockEnd:end]) {
		return refuse("a comment stands between " + nodeText(file, apiName(call)) + " and its generator's body")
	}
	edits = joinEditsAt(edits)
	edits = append(edits, dedentEdits(file, block, len(lineIndent(text, blockStart))-len(lineIndent(text, opening)), edits)...)
	edits = joinEditsAt(edits)
	body := applyEdits(text[:blockEnd], edits)[blockStart:]

	switch {
	case g.isFn && len(g.stages) == 0 && plainMemberDestination(a, outer):
		program, why := plainArrowEffectText(file, g, body)
		if why != "" {
			return refuse(why)
		}
		return &formRewrite{edits: []sourceEdit{{start, end, program}}, description: "a function that returns an effect block"}
	case g.isFn:
		program, why := effectFnText(c, file, g, body)
		if why != "" {
			return refuse(why)
		}
		return &formRewrite{edits: []sourceEdit{{start, end, effectValueParentheses(outer, program)}}, description: "an effect function"}
	case fn != nil && ast.IsArrowFunction(fn):
		at := nodeStart(file, fn)
		return &formRewrite{edits: []sourceEdit{{at, at, "effect "}, {start, end, " " + body}}, description: "an effect function"}
	case fn != nil:
		at := functionKeywordStart(file, fn)
		return &formRewrite{edits: []sourceEdit{{at, at, "effect "}, {start, end, body}}, description: "an effect function"}
	}
	// Effect.gen(…).pipe(stages) changes with its .pipe, whose stages read the
	// block's type: effect { … } |> stages.
	if pipe := pipeOfReceiver(outer); pipe != nil {
		if rewrite := planEffectPipe(c, file, pipe); rewrite.fixable() {
			return &formRewrite{edits: joinEditsAt(append(rewrite.edits, sourceEdit{start, end, "effect " + body})), description: "an effect block"}
		}
	}
	return &formRewrite{edits: []sourceEdit{{start, end, effectValueParentheses(outer, "effect "+body)}}, description: "an effect block"}
}

// pipeOfReceiver returns the .pipe call that node is the receiver of, or nil.
func pipeOfReceiver(node *ast.Node) *ast.Node {
	parent := node.Parent
	if parent == nil || !ast.IsPropertyAccessExpression(parent) || parent.Expression() != node || parent.Parent == nil || !isPipeCall(parent.Parent) {
		return nil
	}
	return parent.Parent
}

// functionKeywordStart returns where fn's text starts past its modifiers:
// its function keyword, or a method's name.
func functionKeywordStart(file *ast.SourceFile, fn *ast.Node) int {
	if modifiers := fn.Modifiers(); modifiers != nil {
		return scanner.SkipTrivia(file.Text(), modifiers.End())
	}
	return nodeStart(file, fn)
}

// effectValueParentheses returns text, an effect block or function that
// replaces node, in parentheses where its parent reads a primary expression
// or a statement would read it as a declaration.
func effectValueParentheses(node *ast.Node, text string) string {
	parent := node.Parent
	switch {
	case ast.IsAsExpression(parent), ast.IsSatisfiesExpression(parent), ast.IsNonNullExpression(parent), ast.IsExpressionStatement(parent),
		ast.IsPropertyAccessExpression(parent), ast.IsElementAccessExpression(parent), ast.IsTaggedTemplateExpression(parent),
		ast.IsCallExpression(parent) && parent.Expression() == node:
		return "(" + text + ")"
	}
	return text
}

// parametersEnd returns the offset just past the ) of fn's parameters, or -1
// for an arrow with no parentheses.
func parametersEnd(file *ast.SourceFile, fn *ast.Node) int {
	text := file.Text()
	at := scanner.SkipTrivia(text, fn.ParameterList().End())
	if at < len(text) && text[at] == ',' {
		at = scanner.SkipTrivia(text, at+1)
	}
	if at >= len(text) || text[at] != ')' {
		return -1
	}
	return at + 1
}

// effectFnText returns the effect function that replaces g, an Effect.fn
// whose rewritten block is body, or why there is none.
func effectFnText(c *checker.Checker, file *ast.SourceFile, g *generatorCall, body string) (string, string) {
	generator := g.generator
	text := file.Text()
	open := generator.ParameterList().Pos() - 1
	if generator.TypeParameterList() != nil {
		open = generator.TypeParameterList().Pos() - 1
	}
	close := parametersEnd(file, generator)
	if close < 0 || open < 0 {
		return "", "its parameters could not be read"
	}
	// The native Effect.fn result prints its inferred parameter tuple, not
	// the generator's annotation syntax. Serialize each checked parameter
	// type, keeping its generic scope rather than reading a widened overload.
	var head []sourceEdit
	for _, parameter := range generator.Parameters() {
		if annotation := parameter.Type(); annotation != nil {
			inferred := c.GetTypeFromTypeNode(annotation)
			if parameter.QuestionToken() != nil {
				inferred = c.GetUnionType([]*checker.Type{inferred, c.GetUndefinedType()})
			}
			printed := c.TypeToStringEx(inferred, annotation, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
			if printed == "" {
				return "", "an inferred parameter type cannot be written"
			}
			if original := nodeText(file, annotation); printed != original {
				if hasComment(original) {
					return "", "a comment stands inside a parameter type that inference expands"
				}
				head = append(head, sourceEdit{nodeStart(file, annotation), annotation.End(), printed})
			}
		}
	}

	signature := applyEdits(text[:close], head)[open:]
	if g.returns != "" {
		if len(g.stages) > 0 {
			return "", "its generator's return type names the Effect before its stages"
		}
		signature += ": " + g.returns // a span keeps the Effect's type
	}
	keepsThis := generator.Name() != nil || usesFunctionThis(generator)
	if g.span == nil && len(g.stages) == 0 {
		if keepsThis {
			return "effect function " + nameOf(generator) + signature + " " + body, ""
		}
		return "effect " + signature + " => " + body, ""
	}
	program := "effect " + body
	for _, stage := range g.stages {
		if arrow := ast.SkipParentheses(stage); ast.IsSpreadElement(stage) || ast.IsFunctionExpressionOrArrowFunction(arrow) && len(arrow.Parameters()) > 1 {
			return "", "a stage is a spread or reads the function's arguments, which a pipe's stage has no access to"
		}
		program += " |> " + pipeStageText(g, file, stage)
	}
	running := "try (" + program + ")"
	if g.span != nil {
		arguments := []string{program}
		for _, argument := range g.span {
			arguments = append(arguments, nodeText(file, argument))
		}
		running = "try " + g.module + ".withSpan(" + strings.Join(arguments, ", ") + ")"
	}
	if keepsThis {
		return "effect function " + nameOf(generator) + signature + " { return " + running + " }", ""
	}
	return "effect " + signature + " => " + running, ""
}

// plainMemberDestination reports whether node is an object literal's
// property whose destination member is a plain function as EK4301 reads it,
// by its declaration with type parameters uninstantiated (D485, D512), such
// as Context.Reference's defaultValue: () => Service. An effect function there
// is EK4301; a plain arrow that returns an effect block is what the member
// declares, and its callers get the same cold program.
func plainMemberDestination(a *analyzer, node *ast.Node) bool {
	c := a.checker
	property := node.Parent
	if property == nil || !ast.IsPropertyAssignment(property) || property.Initializer() != node || property.Name() == nil ||
		!ast.IsIdentifier(property.Name()) && !ast.IsStringLiteral(property.Name()) {
		return false
	}
	contextual := c.GetContextualType(property.Parent, checker.ContextFlagsNone)
	if contextual == nil {
		return false
	}
	member := c.GetPropertyOfType(contextual, property.Name().Text())
	if member == nil {
		return false
	}
	declared := a.declaredPropertyType(member)
	return declared != nil && len(c.GetSignaturesOfType(declared, checker.SignatureKindCall)) > 0 && a.isPlainFunctionType(declared)
}

// plainArrowEffectText writes g, an Effect.fn with no stages, as a plain arrow
// that returns its program: (a) => effect { B }, with its span around it.
func plainArrowEffectText(file *ast.SourceFile, g *generatorCall, body string) (string, string) {
	generator := g.generator
	if generator.Name() != nil || usesFunctionThis(generator) {
		return "", "the generator has a name or reads this, which an arrow function has no own of"
	}
	open := generator.ParameterList().Pos() - 1
	if generator.TypeParameterList() != nil {
		open = generator.TypeParameterList().Pos() - 1
	}
	close := parametersEnd(file, generator)
	if close < 0 || open < 0 {
		return "", "its parameters could not be read"
	}
	signature := file.Text()[open:close]
	if g.returns != "" {
		signature += ": " + g.returns
	}
	program := "effect " + body
	if g.span != nil {
		arguments := []string{program}
		for _, argument := range g.span {
			arguments = append(arguments, nodeText(file, argument))
		}
		program = g.module + ".withSpan(" + strings.Join(arguments, ", ") + ")"
	}
	return signature + " => " + program, ""
}

// nameOf returns generator's name, or "".
func nameOf(generator *ast.Node) string {
	if generator.Name() != nil {
		return generator.Name().Text()
	}
	return ""
}

// usesFunctionThis reports whether generator declares this or reads it.
func usesFunctionThis(generator *ast.Node) bool {
	for _, parameter := range generator.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			return true
		}
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindThisKeyword {
			return true
		}
		if isFunctionBoundary(node) && !ast.IsArrowFunction(node) {
			return false
		}
		return node.ForEachChild(visit)
	}
	return generator.Body().ForEachChild(visit)
}

// pipeStageText returns stage, an Effect.fn's stage, as a pipe's body.
func pipeStageText(g *generatorCall, file *ast.SourceFile, stage *ast.Node) string {
	text := nodeText(file, stage)
	if ast.IsCallExpression(stage) && ast.IsPropertyAccessExpression(stage.Expression()) && nodeText(file, stage.Expression().Expression()) == g.module {
		arguments := []string{"%"}
		for _, argument := range stage.Arguments() {
			arguments = append(arguments, nodeText(file, argument))
		}
		return nodeText(file, stage.Expression()) + "(" + strings.Join(arguments, ", ") + ")"
	}
	if ast.IsIdentifier(stage) || ast.IsPropertyAccessExpression(stage) || ast.IsCallExpression(stage) || ast.IsParenthesizedExpression(stage) {
		return text + "(%)"
	}
	return "(" + text + ")(%)"
}

// isFunctionOfBody reports whether fn is a function, arrow, or method whose
// body is block.
func isFunctionOfBody(fn, block *ast.Node) bool {
	switch fn.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
		return fn.Body() == block
	}
	return false
}

// isSelfThisOption reports whether node is Effect.gen's options object
// { self: this }.
func isSelfThisOption(node *ast.Node) bool {
	if !ast.IsObjectLiteralExpression(node) {
		return false
	}
	properties := node.AsObjectLiteralExpression().Properties.Nodes
	if len(properties) != 1 || !ast.IsPropertyAssignment(properties[0]) {
		return false
	}
	name := properties[0].Name()
	return ast.IsIdentifier(name) && name.Text() == "self" && properties[0].Initializer().Kind == ast.KindThisKeyword
}

// isEffectGenFunction reports whether fn is a function whose body the
// generator's can become: a function declaration or expression, an arrow, or
// a method, with a body, neither async nor a generator.
func isEffectGenFunction(fn *ast.Node) bool {
	switch fn.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
	default:
		return false
	}
	flags := ast.GetFunctionFlags(fn)
	return fn.Body() != nil && flags&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator|ast.FunctionFlagsInvalid) == 0
}

// effectGenScan is what a generator's body holds that its rewrite depends on.
type effectGenScan struct {
	yields   []*ast.Node // the body's yield* expressions, outermost first
	pipes    []*ast.Node // the .pipe calls of an Effect in it, which the rewrite writes as pipes
	throws   []*ast.Node // the throw statements of its own code
	held     []*ast.Node // const initializers that build a program
	usesThis bool        // the body reads this, its own or through an arrow
	why      string      // the first construct whose rewrite would mean something else
}

// heldProgram returns the initializer of node, a variable declaration, when
// it builds a program that a later statement runs: a call or a pipe of an
// Effect, with no yield* in it, in a declaration with no type.
func heldProgram(c *checker.Checker, node *ast.Node) *ast.Node {
	initializer := node.Initializer()
	if initializer == nil || node.Type() != nil {
		return nil
	}
	inner := ast.SkipParentheses(initializer)
	if !isPipe(inner) && !(isPipeCall(inner) && isEffectPipeline(c, inner)) && !(isInvocation(inner) && callReturnsEffect(c, inner)) {
		return nil
	}
	var holdsYield func(n *ast.Node) bool
	holdsYield = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		return ast.IsYieldExpression(n) || n.ForEachChild(holdsYield)
	}
	if holdsYield(inner) {
		return nil
	}
	return initializer
}

// markPipeCalls adds to operands each call of node's pipeline, |> or .pipe,
// which the pipeline holds or which stands in a stage that it applies.
func markPipeCalls(node *ast.Node, operands map[*ast.Node]bool) {
	for node = ast.SkipParentheses(node); ; {
		switch {
		case isPipe(node):
			operands[ast.SkipParentheses(node.AsBinaryExpression().Right)] = true
			node = ast.SkipParentheses(node.AsBinaryExpression().Left)
		case isPipeCall(node):
			for _, stage := range node.Arguments() {
				operands[ast.SkipParentheses(stage)] = true
			}
			node = ast.SkipParentheses(node.Expression().Expression())
		default:
			operands[node] = true
			return
		}
		operands[node] = true
	}
}

// scanEffectGenBody reads generator's body for its rewrite.
func scanEffectGenBody(c *checker.Checker, a *analyzer, file *ast.SourceFile, generator *ast.Node) *effectGenScan {
	s := &effectGenScan{}
	name := ""
	if generator.Name() != nil {
		name = generator.Name().Text()
	}
	operands := map[*ast.Node]bool{} // the calls that yield* runs or a program holds
	effectCode := 0                  // depth of effect functions and blocks, an earlier fix's, which run with try
	var visit func(node *ast.Node, own, lexical bool, callback *ast.Node) bool
	visit = func(node *ast.Node, own, lexical bool, callback *ast.Node) bool {
		if s.why != "" {
			return true
		}
		switch {
		case isFunctionBoundary(node):
			if ast.IsFunctionLike(node) && node.BodyData() != nil && node.BodyData().AsteriskToken != nil {
				s.why = "it holds another function*; its Effect.gen is fixed first, when it can be"
				return true
			}
			arrow := ast.IsArrowFunction(node)
			inner := callback
			if ast.IsFunctionLike(node) {
				inner = node
			}
			if node.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				effectCode++
				defer func() { effectCode-- }()
			}
			return node.ForEachChild(func(child *ast.Node) bool { return visit(child, false, lexical && arrow, inner) })
		case node.Kind == ast.KindThisKeyword:
			if lexical {
				s.usesThis = true
			}
		case node.Kind == ast.KindSuperKeyword:
			if lexical {
				s.why = "the generator reads super"
			}
		case ast.IsMetaProperty(node) && node.AsMetaProperty().KeywordToken == ast.KindNewKeyword:
			if lexical {
				s.why = "the generator reads new.target"
			}
		case ast.IsIdentifier(node) && node.Text() == "arguments" && lexical && readsBinding(node):
			s.why = "the generator reads its own arguments"
		case ast.IsIdentifier(node) && name != "" && node.Text() == name && node != generator.Name() && readsBinding(node) && !generatorKeepsName(c, generator):
			s.why = "the generator refers to itself by its name, " + name
		case ast.IsYieldExpression(node):
			if node.AsYieldExpression().AsteriskToken == nil || node.Expression() == nil {
				s.why = "it yields a value with yield, not yield*"
				return true
			}
			if !own {
				s.why = "a yield* stands outside the generator's own code"
				return true
			}
			s.yields = append(s.yields, node)
			operand := ast.SkipParentheses(node.Expression())
			if isInvocation(operand) {
				operands[operand] = true
			}
			if isPipe(operand) || isPipeCall(operand) && isEffectPipeline(c, operand) {
				markPipeCalls(operand, operands)
			}
		case ast.IsThrowStatement(node):
			if own {
				s.throws = append(s.throws, node)
			}
		case ast.IsTryStatement(node):
			if own {
				s.why = "a try statement in a generator catches JavaScript exceptions, which in VibeLang it would not, and catches expected failures"
			}
		case ast.IsVariableDeclarationList(node) && node.Flags&ast.NodeFlagsUsing != 0:
			s.why = "a using declaration in a generator disposes as JavaScript does, which in VibeLang would hold a scope"
		case ast.IsVariableDeclaration(node) && own:
			if held := heldProgram(c, node); held != nil {
				s.held = append(s.held, held)
				inner := ast.SkipParentheses(held)
				operands[inner] = true
				if isPipeCall(inner) {
					s.pipes = append(s.pipes, inner)
				}
				markPipeCalls(inner, operands)
			}
		case isPipe(node) || isPipeCall(node) && isEffectPipeline(c, node):
			if isPipeCall(node) {
				s.pipes = append(s.pipes, node)
			}
			markPipeCalls(node, operands)
		case isInvocation(node) && !operands[node] && effectCode == 0:
			if why := effectGenCallMeaning(c, a, file, node, own, callback); why != "" {
				s.why = why
				return true
			}
		}
		return node.ForEachChild(func(child *ast.Node) bool { return visit(child, own, lexical, callback) })
	}
	generator.Body().ForEachChild(func(child *ast.Node) bool { return visit(child, true, true, nil) })
	return s
}

// readsBinding reports whether an identifier reads a binding: an expression
// that is not the member name of input.arguments, or the name of the shorthand
// { arguments }, which reads the binding it names.
func readsBinding(node *ast.Node) bool {
	if ast.IsShorthandPropertyAssignment(node.Parent) && node.Parent.Name() == node {
		return true
	}
	return ast.IsExpressionNode(node) && !ast.IsRightSideOfPropertyAccess(node)
}

// generatorKeepsName reports whether generator's rewrite keeps its name: an
// Effect.fn's keeps it, as effect function name.
func generatorKeepsName(c *checker.Checker, generator *ast.Node) bool {
	parent := generator.Parent
	return parent != nil && ast.IsCallExpression(parent) && len(parent.Arguments()) > 0 && parent.Arguments()[0] == generator && !isEffectFunction(c, parent.Expression(), "Effect", "gen")
}

// effectGenCallMeaning returns why call, which no yield* runs, would mean
// something else in the rewrite, or "". In the generator's own code a call
// that builds a program builds it; in VibeLang it would run. In a callback,
// such as forEach's, a call that builds the program the callback returns keeps
// its meaning: the callback becomes an Effect function that runs it.
func effectGenCallMeaning(c *checker.Checker, a *analyzer, file *ast.SourceFile, call *ast.Node, own bool, callback *ast.Node) string {
	if !a.performs(call) {
		return ""
	}
	label := shortText(expressionText(file, call), "a call")
	if own {
		return label + " builds a program that no yield* runs, and in VibeLang it would run where it stands"
	}
	outer := call
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if callback != nil && (outer.Parent == callback && callback.Body() == outer || ast.IsReturnStatement(outer.Parent) && ast.GetContainingFunction(outer.Parent) == callback) {
		return ""
	}
	return "in a callback, " + label + " builds a program that the callback does not return, and in VibeLang it would run where it stands"
}

// effectGenTryEdit returns the edits that write y, a yield* of the body, as
// what runs its operand where it stands, or why there is none.
func effectGenTryEdit(c *checker.Checker, file *ast.SourceFile, y *ast.Node) ([]sourceEdit, string) {
	text := file.Text()
	operand := y.Expression()
	inner := ast.SkipParentheses(operand)
	label := shortText("yield* "+expressionText(file, operand), "a yield*")
	start := nodeStart(file, y)
	asterisk := y.AsYieldExpression().AsteriskToken.End()
	operandStart := nodeStart(file, operand)
	gap := text[asterisk:operandStart]
	// try takes yield*'s place; a comment after it stays, on its line.
	keyword := sourceEdit{start, operandStart, "try "}
	if strings.TrimSpace(gap) != "" {
		if strings.ContainsAny(gap, "\r\n") {
			return nil, label + " has a comment and a line break between yield* and its operand"
		}
		keyword = sourceEdit{start, asterisk, "try"}
	}
	t := c.GetTypeAtLocation(operand)
	// Effect.succeed(x) gives x.
	if ast.IsCallExpression(inner) && len(inner.Arguments()) == 1 && isEffectFunction(c, inner.Expression(), "Effect", "succeed") && strings.TrimSpace(gap) == "" {
		argument := inner.Arguments()[0]
		return []sourceEdit{{start, nodeStart(file, argument), ""}, {argument.End(), operand.End(), ""}}, ""
	}
	// Effect.fail(e) in a statement is throw e. An error instance fails as
	// throw fails with it, which only a statement writes: elsewhere it is
	// Effect.fail(e), since try e would give a value of the error.
	if ast.IsCallExpression(inner) && len(inner.Arguments()) == 1 && isEffectFunction(c, inner.Expression(), "Effect", "fail") {
		argument := inner.Arguments()[0]
		if edits := throwEdits(file, y, start, nodeStart(file, argument)); edits != nil {
			return append(edits, sourceEdit{argument.End(), operand.End(), ""}), ""
		}
	}
	if t != nil && failsAsError(c, t) {
		if edits := throwEdits(file, y, start, operandStart); edits != nil {
			return edits, ""
		}
		return []sourceEdit{keyword, {operandStart, operandStart, "Effect.fail("}, {operand.End(), operand.End(), ")"}}, ""
	}
	if t != nil {
		// An Effect.Yieldable that is no Effect runs through asEffect().
		if !isEffectValueType(c, t) && !isEffectType(c, t) && yieldsEffect(c, t) {
			if needsOperandParentheses(operand) {
				return []sourceEdit{keyword, {operandStart, operandStart, "("}, {operand.End(), operand.End(), ").asEffect()"}}, ""
			}
			return []sourceEdit{keyword, {operand.End(), operand.End(), ".asEffect()"}}, ""
		}
	}
	if tryOperandNeedsParentheses(c, operand) {
		return []sourceEdit{keyword, {operandStart, operandStart, "("}, {operand.End(), operand.End(), ")"}}, ""
	}
	return []sourceEdit{keyword}, ""
}

// tryOperandNeedsParentheses reports whether operand, once a yield*'s, must
// be parenthesized after try, which takes a unary expression.
func tryOperandNeedsParentheses(c *checker.Checker, operand *ast.Node) bool {
	if isPipeCall(operand) && isEffectPipeline(c, operand) {
		return true // it becomes a pipe
	}
	if isEffectBlock(operand) {
		return false // try effect { … }; in parentheses it reads as the retired try(…) hatch, EK4616
	}
	switch operand.Kind {
	case ast.KindBinaryExpression, ast.KindConditionalExpression, ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindAsExpression, ast.KindSatisfiesExpression:
		return true
	}
	return false
}

// throwEdits writes throw for node, a yield* or a try, that stands alone as
// an expression statement or as what a return statement returns: the text
// from start, or from the return, to operandStart becomes "throw ". It
// returns nil where node stands elsewhere.
func throwEdits(file *ast.SourceFile, node *ast.Node, start, operandStart int) []sourceEdit {
	n := node
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	switch statement := n.Parent; {
	case statement != nil && ast.IsExpressionStatement(statement) && statement.Expression() == n && n == node:
		return []sourceEdit{{start, operandStart, "throw "}}
	case statement != nil && ast.IsReturnStatement(statement) && statement.Expression() == n && n == node:
		return []sourceEdit{{nodeStart(file, statement), operandStart, "throw "}}
	}
	return nil
}

// holdsEffectValue reports whether t, or a member of its union, is an Effect value.
func holdsEffectValue(c *checker.Checker, t *checker.Type) bool {
	return slices.ContainsFunc(t.Distributed(), func(member *checker.Type) bool { return isEffectValueType(c, member) })
}

// isYieldableError reports whether t is an error instance that is also an
// Effect that fails with itself, as Data.TaggedError's are.
func isYieldableError(c *checker.Checker, t *checker.Type) bool {
	effect := effectOfValue(c, t)
	if effect == nil || c.GetPropertyOfType(t, "message") == nil || c.GetPropertyOfType(t, "stack") == nil {
		return false
	}
	success := successType(c, effect)
	return success != nil && success.Flags()&checker.TypeFlagsNever != 0
}

// failsAsError reports whether t is an error that yield* fails with: an
// Effect error instance (isYieldableError), or, while the checker has not
// resolved its Effect channels yet, a class that extends effect's
// YieldableError.
func failsAsError(c *checker.Checker, t *checker.Type) bool {
	return isYieldableError(c, t) || extendsYieldableError(c, t, 0)
}

// yieldsEffect reports whether t is an Effect.Yieldable that is no Effect:
// a value whose asEffect() gives the Effect yield* runs, as alchemy's Output
// does. try x of one runs it as try x.asEffect().
func yieldsEffect(c *checker.Checker, t *checker.Type) bool {
	property := c.GetPropertyOfType(t, "asEffect")
	if property == nil {
		return false
	}
	for _, signature := range c.GetSignaturesOfType(c.GetTypeOfSymbol(property), checker.SignatureKindCall) {
		if len(signature.Parameters()) == 0 && isEffectType(c, c.GetReturnTypeOfSignature(signature)) {
			return true
		}
	}
	return false
}

// hasComment reports whether text, source between tokens, holds a comment.
func hasComment(text string) bool {
	return strings.Contains(text, "//") || strings.Contains(text, "/*")
}

// dedentEdits returns the edits that remove width columns of indentation from
// each line of block after its first, so that a block moved out of a call
// lines up with its new braces. A line inside a template literal or a string
// keeps its text, and a line that edits already touch is left alone. When a
// line has less indentation than width, nothing is removed.
func dedentEdits(file *ast.SourceFile, block *ast.Node, width int, edits []sourceEdit) []sourceEdit {
	if width <= 0 {
		return nil
	}
	text := file.Text()
	var literals [][2]int
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateExpression, ast.KindStringLiteral:
			literals = append(literals, [2]int{nodeStart(file, node), node.End()})
			return false
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	var out []sourceEdit
	start, end := nodeStart(file, block), block.End()
	for i := strings.IndexByte(text[start:end], '\n'); i >= 0; {
		line := start + i + 1
		next := strings.IndexByte(text[line:end], '\n')
		lineEnd := end
		if next >= 0 {
			lineEnd = line + next
		}
		inside := slices.ContainsFunc(literals, func(r [2]int) bool { return r[0] < line && line < r[1] }) ||
			slices.ContainsFunc(edits, func(e sourceEdit) bool { return e.start < line && line <= e.end })
		if !inside {
			n := 0
			for line+n < lineEnd && n < width && (text[line+n] == ' ' || text[line+n] == '\t') {
				n++
			}
			if n < width && strings.TrimSpace(text[line:lineEnd]) != "" {
				return nil // a line less indented than the rest: keep the text as it is
			}
			if n > 0 {
				out = append(out, sourceEdit{line, line + n, ""})
			}
		}
		if next < 0 {
			break
		}
		i = line + next - start
	}
	return out
}
