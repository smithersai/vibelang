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
)

// EK1002's quick fix (D470) writes an Effect.gen program in VibeLang's direct
// style, the rewrite a migration from Effect TypeScript makes most often:
//
//	const greet = (id: string) =>          const greet = (id: string) => {
//	  Effect.gen(function* () {              const users = Users()
//	    const users = yield* Users           const name = users.find(id)
//	    const name = yield* users.find(id)   return `Hello, ${name}`
//	    return `Hello, ${name}`            }
//	  })
//
// Each yield* e becomes what runs e where it stands (Chapter 13, rule R): the
// call e itself when it runs, e() for an Effect value such as a service key
// or a Config, and throw e for an error instance in a statement. It rewrites
// Effect.gen(function* () { … }) and Effect.gen({ self: this }, function* () { … })
// in two places:
//
//   - the whole body of a function: an arrow's expression body, or the one
//     return statement of a function, arrow, or method. The function's body
//     becomes the generator's, so a call of it runs the body as calling the
//     function and running its Effect did.
//   - a destination that takes only a program: an argument, a field, a typed
//     const, or an element whose declared type is an Effect. The call becomes
//     () => { … }, which converts to a program that runs the body each time.
//
// The fix keeps the program's meaning (Chapter 28), so it refuses, with a
// note that says why, a generator whose direct-style body would mean something
// else: a call that builds a program the generator never yields, which would
// run (rule R); a yield* of a value that is not definitely an Effect, or whose
// success value is itself a program; a callback whose program-building call is
// not the value it returns; throw and try, which mean a JavaScript exception
// in a generator and an expected failure in VibeLang; this without
// { self: this }, arguments, new.target, super, and a nested function*; a
// parameter that a default or a pattern binds, which TypeScript binds at the
// call and VibeLang when the program runs; and a body that runs no Effect, so
// that the function would compile to plain JavaScript and change its type.
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
		rewrite := planEffectGen(c, fix.SourceFile, callee.Parent)
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
			span = nodeText(file, callee.Parent)
		}
	}
	return diagnosticSource + strconv.Itoa(int(d.Code())) + ":" + span
}

// isCallee reports whether node is the callee of a call.
func isCallee(node *ast.Node) bool {
	return node.Parent != nil && ast.IsCallExpression(node.Parent) && node.Parent.Expression() == node
}

// noteEffectGenFix adds to d, EK1002 at call, whether its quick fix writes
// the body in direct style, or why it does not.
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

// effectGenPlace is where an Effect.gen call stands, for its rewrite.
type effectGenPlace uint8

const (
	genArrowBody effectGenPlace = iota + 1 // an arrow function's expression body
	genReturn                              // the only statement of a function's body, a return
	genProgram                             // a destination that takes only a program
)

// planEffectGen plans EK1002's fix for call, an Effect.gen call: the edits, or
// the note that says why there are none. It returns nil for a call that is not
// Effect.gen, such as Effect.fn, which has no direct style of its own.
func planEffectGen(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !ast.IsCallExpression(call) || !isEffectFunction(c, call.Expression(), "Effect", "gen") {
		return nil
	}
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why + "."}
	}
	arguments := call.Arguments()
	if call.TypeArguments() != nil || len(arguments) == 0 || len(arguments) > 2 {
		return refuse("the call has type arguments or an unusual argument list")
	}
	generator := arguments[len(arguments)-1]
	if !ast.IsFunctionExpression(generator) || generator.BodyData().AsteriskToken == nil || ast.GetFunctionFlags(generator)&ast.FunctionFlagsAsync != 0 ||
		len(generator.Parameters()) > 0 || generator.TypeParameters() != nil || generator.Type() != nil || generator.Body() == nil {
		return refuse("its generator is not a function* () { … } written in place")
	}
	selfIsThis := false
	if len(arguments) == 2 {
		if !isSelfThisOption(arguments[0]) {
			return refuse("its self option is not { self: this }")
		}
		selfIsThis = true
	}
	a := analyzerFor(c)
	text := file.Text()
	block := generator.Body()
	blockStart, blockEnd := nodeStart(file, block), block.End()

	// Where the call stands decides what replaces it.
	outer := call
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	var place effectGenPlace
	var fn *ast.Node
	parent := outer.Parent
	switch {
	case ast.IsArrowFunction(parent) && parent.Body() == outer:
		place, fn = genArrowBody, parent
	case ast.IsReturnStatement(parent) && ast.IsBlock(parent.Parent) && len(parent.Parent.Statements()) == 1 && isFunctionOfBody(parent.Parent.Parent, parent.Parent):
		place, fn = genReturn, parent.Parent.Parent
	case isEffectGenProgramPosition(a, outer):
		place = genProgram
	default:
		return refuse("Effect.gen here is a program value, not the body of a function or an argument that takes a program; write it as a function, () => { … }, where it is used")
	}
	if fn != nil && !isEffectGenFunction(fn) {
		return refuse("the function around it is async, a generator, an accessor, or a constructor")
	}

	// What the body holds decides whether its direct style means the same.
	scan := scanEffectGenBody(c, a, file, generator, fn)
	if scan.why != "" {
		return refuse(scan.why)
	}
	if scan.usesThis && !selfIsThis {
		return refuse("the generator reads this, which Effect.gen leaves undefined, but the function's body would read the function's own this")
	}
	if fn != nil {
		for _, parameter := range fn.Parameters() {
			if parameter.Initializer() != nil || ast.IsBindingPattern(parameter.Name()) {
				return refuse("a parameter has a default or a pattern, which TypeScript binds when the function is called and VibeLang when its program runs")
			}
			if ast.IsIdentifier(parameter.Name()) && scan.declared[parameter.Name().Text()] {
				return refuse("the generator declares " + parameter.Name().Text() + ", a name the function's parameter has")
			}
		}
		if len(scan.yields) == 0 && !keepsEffectGenForm(a, fn) {
			return refuse("the body runs no Effect, so the function would compile to plain JavaScript and its type would change")
		}
	}

	// The rewritten body.
	var edits []sourceEdit
	for _, y := range scan.yields {
		edit, why := effectGenYieldEdit(c, a, file, y)
		if why != "" {
			return refuse(why)
		}
		edits = append(edits, edit...)
	}
	var start, end int
	var opening int // where the rewritten block's { stands
	var prefix string
	switch place {
	case genArrowBody:
		start, end, prefix = fn.AsArrowFunction().EqualsGreaterThanToken.End(), fn.Body().End(), " "
		opening = start
	case genReturn:
		start, end = nodeStart(file, fn.Body()), fn.Body().End()
		opening = start
	case genProgram:
		start, end, prefix = nodeStart(file, outer), outer.End(), "() => "
		opening = blockStart
	}
	// Only Effect.gen, its generator's head, a return and the braces stand
	// outside the generator's block: a comment there would have no place.
	if hasComment(text[start:blockStart]) || hasComment(text[blockEnd:end]) {
		return refuse("a comment stands between Effect.gen and its generator's body")
	}
	edits = append(edits, dedentEdits(file, block, len(lineIndent(text, blockStart))-len(lineIndent(text, opening)), edits)...)
	body := applyEdits(text[:blockEnd], edits)[blockStart:]
	return &formRewrite{edits: []sourceEdit{{start, end, prefix + body}}, description: "the body in direct style"}
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

// isEffectGenProgramPosition reports whether node stands where its declared
// type takes only a program (Chapter 13, rule F): an argument, an object
// literal's field, an array literal's element, or the initializer of a
// variable whose type is written, whose expected type is an Effect and no
// function. A function with no parameters converts to a program there.
func isEffectGenProgramPosition(a *analyzer, node *ast.Node) bool {
	parent := node.Parent
	switch {
	case ast.IsCallExpression(parent) && parent.Expression() != node,
		ast.IsPropertyAssignment(parent) && parent.Initializer() == node,
		ast.IsArrayLiteralExpression(parent),
		ast.IsVariableDeclaration(parent) && parent.Initializer() == node && parent.Type() != nil:
	default:
		return false
	}
	e := a.classify(a.contextualTypes(node))
	return e.program && !e.effectFn && !e.plainFn
}

// keepsEffectGenForm reports whether fn stays an Effect function whatever its
// body runs: one with a written contract, or a lambda or method whose expected
// type asks for an Effect function only. A function declaration does not: its
// TypeScript callers would still receive an Effect (D10), but a VibeLang
// caller's call of it would give the value where it gave the program.
func keepsEffectGenForm(a *analyzer, fn *ast.Node) bool {
	if fn.Type() != nil {
		return true
	}
	if ast.IsMethodDeclaration(fn) {
		return a.expectsEffect(fn)
	}
	e := a.classify(a.contextualTypes(fn))
	return e.effectFn && !e.plainFn && !e.program
}

// effectGenScan is what a generator's body holds that its rewrite depends on.
type effectGenScan struct {
	yields   []*ast.Node     // the body's yield* expressions, outermost first
	declared map[string]bool // names the body's own code declares
	usesThis bool            // the body reads this, its own or through an arrow
	why      string          // the first construct whose direct style would mean something else
}

// scanEffectGenBody reads generator's body for its rewrite in fn, or in a
// program when fn is nil.
func scanEffectGenBody(c *checker.Checker, a *analyzer, file *ast.SourceFile, generator, fn *ast.Node) *effectGenScan {
	s := &effectGenScan{declared: map[string]bool{}}
	name := ""
	if generator.Name() != nil {
		name = generator.Name().Text()
	}
	operands := map[*ast.Node]bool{} // the calls that yield* runs
	var visit func(node *ast.Node, own, lexical bool, callback *ast.Node) bool
	visit = func(node *ast.Node, own, lexical bool, callback *ast.Node) bool {
		if s.why != "" {
			return true
		}
		switch {
		case isFunctionBoundary(node):
			if own && (ast.IsFunctionDeclaration(node) || ast.IsClassDeclaration(node)) && node.Name() != nil {
				s.declared[node.Name().Text()] = true
			}
			if ast.IsFunctionLike(node) && node.BodyData() != nil && node.BodyData().AsteriskToken != nil {
				s.why = "it holds another function*; its Effect.gen is fixed first, when it can be"
				return true
			}
			arrow := ast.IsArrowFunction(node)
			inner := callback
			if ast.IsFunctionLike(node) {
				inner = node
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
		case ast.IsMetaProperty(node):
			if lexical {
				s.why = "the generator reads new.target"
			}
		case ast.IsIdentifier(node) && node.Text() == "arguments" && lexical && ast.IsExpressionNode(node):
			s.why = "the generator reads its own arguments"
		case ast.IsIdentifier(node) && name != "" && node.Text() == name && node != generator.Name() && ast.IsExpressionNode(node):
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
			if operand := ast.SkipParentheses(node.Expression()); isInvocation(operand) {
				operands[operand] = true
			}
		case ast.IsThrowStatement(node):
			s.why = "a throw in a generator throws a JavaScript exception, which in VibeLang would be an expected failure"
		case ast.IsTryStatement(node):
			s.why = "a try statement in a generator catches JavaScript exceptions, which in VibeLang it would not, and catches expected failures"
		case ast.IsVariableDeclarationList(node) && node.Flags&ast.NodeFlagsUsing != 0:
			s.why = "a using declaration in a generator disposes as JavaScript does, which in VibeLang would hold a scope"
		case ast.IsVariableDeclaration(node) && own:
			declareNames(node.Name(), s.declared)
		case isInvocation(node) && !operands[node]:
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

// declareNames records the names a binding name declares.
func declareNames(name *ast.Node, names map[string]bool) {
	switch {
	case name == nil:
	case ast.IsIdentifier(name):
		names[name.Text()] = true
	case ast.IsBindingPattern(name):
		for _, element := range name.AsBindingPattern().Elements.Nodes {
			if ast.IsBindingElement(element) {
				declareNames(element.Name(), names)
			}
		}
	}
}

// effectGenCallMeaning returns why call, which no yield* runs, would mean
// something else in direct style, or "". In the generator's own code a call
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

// effectGenYieldEdit returns the edits that write y, a yield* of the body, as
// what runs its operand where it stands, or why there is none.
func effectGenYieldEdit(c *checker.Checker, a *analyzer, file *ast.SourceFile, y *ast.Node) ([]sourceEdit, string) {
	text := file.Text()
	operand := y.Expression()
	inner := ast.SkipParentheses(operand)
	label := shortText("yield* "+expressionText(file, operand), "a yield*")
	if ast.IsYieldExpression(inner) {
		return nil, label + " yields a yield"
	}
	givesProgram := func(effect *checker.Type) bool {
		success := successType(c, effect)
		if success == nil && effect != nil {
			success = varianceChannel(c, effect, "_A")
		}
		return success != nil && holdsEffectValue(c, success) || holdsEffectValue(c, c.GetTypeAtLocation(y))
	}
	const programValue = " gives a program as its value, which VibeLang would run or hold by its declared type"
	start := nodeStart(file, y)
	asterisk := y.AsYieldExpression().AsteriskToken.End()
	operandStart := nodeStart(file, operand)
	gap := text[asterisk:operandStart]
	// yield* and the space after it go; a comment after it stays, on its line.
	keyword := sourceEdit{start, operandStart, ""}
	if strings.TrimSpace(gap) != "" {
		if strings.ContainsAny(gap, "\r\n") {
			return nil, label + " has a comment and a line break between yield* and its operand"
		}
		keyword = sourceEdit{start, asterisk, ""}
	}
	// An error fails as throw fails with it: yield* new E() and yield* toError(id)
	// are throw, which only a statement writes; dropping yield* would make
	// the error the program's value.
	if t := c.GetTypeAtLocation(operand); t != nil && failsAsError(c, t) {
		if edits := throwEdits(file, y, start, operandStart); edits != nil {
			return edits, ""
		}
		return nil, label + " fails with an error, which only a throw statement writes"
	}
	if isInvocation(inner) {
		if ast.IsOptionalChain(inner) {
			return nil, label + " runs an optional call, which yield* would fail on when it is undefined"
		}
		signature := c.GetResolvedSignature(inner)
		// A .vibe function may construct a structured Effect (D24), such as
		// a SQL query. Its call still returns data: the yielded result must
		// be called too, even though its implementation is VibeLang.
		structured := signature != nil && isStructuredEffectResult(c, c.GetReturnTypeOfSignature(signature))
		if !structured && (a.runs(inner) || a.callsVibeLangFunction(inner)) {
			if signature != nil && givesProgram(c.GetReturnTypeOfSignature(signature)) {
				return nil, label + programValue
			}
			return []sourceEdit{keyword}, ""
		}
	}
	t := c.GetTypeAtLocation(operand)
	if t == nil || len(c.GetSignaturesOfType(c.GetApparentType(t), checker.SignatureKindCall)) != 0 || effectOfValue(c, t) == nil {
		return nil, label + " runs a value that is not definitely an Effect"
	}
	if givesProgram(effectOfValue(c, t)) {
		return nil, label + programValue
	}
	open, close := "", "()"
	if needsOperandParentheses(operand) && !ast.IsParenthesizedExpression(operand) {
		open, close = "(", ")()"
	}
	if keyword.end == operandStart {
		return []sourceEdit{{keyword.start, keyword.end, open}, {operand.End(), operand.End(), close}}, ""
	}
	edits := []sourceEdit{keyword}
	if open != "" {
		edits = append(edits, sourceEdit{operandStart, operandStart, open})
	}
	return append(edits, sourceEdit{operand.End(), operand.End(), close}), ""
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
