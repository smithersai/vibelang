package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The refactors that stand for those of Effect's language service (D245).
// Each is a refactor.rewrite code action in a .vibe file, offered where
// the cursor is:
//
//	Write the inferred contract     function load(id: string): User!NotFound!Users { … }
//	Remove the contract             the reverse
//	Convert to a schema declaration interface User { … } becomes schema User { … }
//	Convert to a VibeLang function   async function f() { await p } becomes function f() { try(p) }
//	  and write an error per await  try(p, (cause) => new PFailed({ cause })), with error PFailed { cause: unknown }
//	Convert to a pipe               f(g(x)) becomes x |> g(%) |> f(%)
//	Convert the pipe to calls       the reverse
//	Write pipe(x, …) / x.pipe(…)    toggles the two pipe styles

func init() {
	ls.RegisterRefactorProvider(vibelangRefactors)
}

// refactorContext is one refactor request.
type refactorContext struct {
	*ls.RefactorContext
	c    *checker.Checker
	a    *analyzer
	file *ast.SourceFile
	pos  int
}

// vibelangRefactors returns the refactors offered at the start of r's span.
func vibelangRefactors(ctx context.Context, r *ls.RefactorContext) []*ls.CodeAction {
	if !isVibeLangFile(r.SourceFile) {
		return nil
	}
	c, done := r.Program.GetTypeCheckerForFile(ctx, r.SourceFile)
	defer done()
	rc := &refactorContext{RefactorContext: r, c: c, a: analyzerFor(c), file: r.SourceFile, pos: r.Span.Pos()}
	var actions []*ls.CodeAction
	found := map[string]bool{}
	add := func(kind string, more []*ls.CodeAction) {
		if !found[kind] && len(more) > 0 {
			found[kind] = true
			actions = append(actions, more...)
		}
	}
	for n := astnav.GetTouchingToken(rc.file, rc.pos); n != nil; n = n.Parent {
		switch {
		case isLowerable(n) && rc.inHeader(n):
			add("contract", rc.contractRefactors(n))
		case ast.IsFunctionLike(n) && ast.GetFunctionFlags(n)&ast.FunctionFlagsAsync != 0 && n.Body() != nil && rc.inHeader(n):
			add("async", rc.asyncRefactors(n))
		case ast.IsInterfaceDeclaration(n) || ast.IsTypeAliasDeclaration(n):
			add("schema", rc.schemaRefactor(n))
		case isPipe(n):
			add("pipe", rc.pipeToCalls(outermostPipe(n)))
		case ast.IsCallExpression(n):
			add("calls", rc.callsToPipe(n))
			add("style", rc.togglePipeStyle(n))
		}
	}
	return actions
}

// inHeader reports whether the request's position is in fn's header: from
// its start to its body.
func (rc *refactorContext) inHeader(fn *ast.Node) bool {
	return nodeStart(rc.file, fn) <= rc.pos && rc.pos <= nodeStart(rc.file, fn.Body())
}

// action returns one refactor that replaces start to end with text.
func (rc *refactorContext) action(description string, start, end int, text string) *ls.CodeAction {
	return &ls.CodeAction{Description: description, Changes: []*lsproto.TextEdit{rc.textEdit(start, end, text)}}
}

func (rc *refactorContext) textEdit(start, end int, text string) *lsproto.TextEdit {
	return &lsproto.TextEdit{Range: rc.LS.ToLSPRange(rc.file, core.NewTextRange(start, end)), NewText: text}
}

// contractRefactors offers to write fn's inferred contract, or to remove the
// one it has: Effect's "Toggle return type signature".
func (rc *refactorContext) contractRefactors(fn *ast.Node) []*ls.CodeAction {
	if annotation := fn.Type(); annotation != nil {
		if rc.a.contractOf(fn) == nil {
			return nil // a plain annotation, not a contract
		}
		start := strings.LastIndexByte(rc.file.Text()[:annotation.Pos()], ':')
		return []*ls.CodeAction{rc.action("Remove the contract", start, annotation.End(), "")}
	}
	if isProducer(fn) {
		return nil
	}
	// A pure function can use the direct path while its public signature
	// still returns Effect. Its inferred contract can be written too (D10).
	contract := rc.c.GetReturnTypeOfSignature(rc.c.GetSignatureFromDeclaration(fn))
	if !isEffectType(rc.c, contract) {
		return nil
	}
	var texts []string
	for _, t := range []*checker.Type{successType(rc.c, contract), channelType(rc.c, contract, "_E"), channelType(rc.c, contract, "_R")} {
		texts = append(texts, rc.c.TypeToStringEx(t, fn, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseAliasDefinedOutsideCurrentScope, nil))
	}
	close := closeParenOf(rc.file, fn)
	if close < 0 {
		return nil
	}
	return []*ls.CodeAction{rc.action("Write the inferred contract", close, close, ": "+bangText(texts...))}
}

// closeParenOf returns the position after the ) that closes fn's parameter
// list, or -1.
func closeParenOf(file *ast.SourceFile, fn *ast.Node) int {
	parameters := fn.Parameters()
	from := nodeStart(file, fn)
	if len(parameters) > 0 {
		from = parameters[len(parameters)-1].End()
	}
	if fn.Name() != nil && len(parameters) == 0 {
		from = fn.Name().End()
	}
	text := file.Text()
	for i := from; i < nodeStart(file, fn.Body()); i++ {
		if text[i] == ')' {
			return i + 1
		}
	}
	return -1
}

// schemaRefactor offers to write declaration, an interface or a type alias
// of an object type, as a schema declaration (D133): Effect's "Structural
// Type to Schema" and its typeToSchema codegen.
func (rc *refactorContext) schemaRefactor(declaration *ast.Node) []*ls.CodeAction {
	if declaration.TypeParameters() != nil || declaration.Flags&ast.NodeFlagsVibeLang != 0 {
		return nil
	}
	text := rc.file.Text()
	start := nodeStart(rc.file, declaration)
	var body string
	switch {
	case ast.IsInterfaceDeclaration(declaration):
		if len(ast.GetExtendsHeritageClauseElements(declaration)) > 0 {
			return nil
		}
		open := strings.IndexByte(text[declaration.Name().End():declaration.End()], '{')
		if open < 0 {
			return nil
		}
		body = text[declaration.Name().End()+open : declaration.End()]
	case declaration.Type() != nil && ast.IsTypeLiteralNode(declaration.Type()):
		body = scanner.GetTextOfNode(declaration.Type())
	default:
		return nil
	}
	modifiers := ""
	if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsExport) {
		modifiers = "export "
	}
	return []*ls.CodeAction{rc.action("Convert to a schema declaration", start, declaration.End(), modifiers+"schema "+declaration.Name().Text()+" "+body)}
}

// asyncRefactors offers to convert fn, an async function, to a VibeLang
// function: Effect's four "async function to Effect" refactors, which
// VibeLang's one function form makes two. Each await of a promise becomes a try
// hatch that passes the bindings the promise reads as inputs (D229), and with
// the second refactor maps a rejection to an error declaration of its own.
func (rc *refactorContext) asyncRefactors(fn *ast.Node) []*ls.CodeAction {
	var awaits []*ast.Node
	nested := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindAwaitExpression {
			awaits = append(awaits, n)
			n.Expression().ForEachChild(func(inner *ast.Node) bool {
				nested = nested || containsAwait(inner)
				return nested
			})
			return false
		}
		if n.Kind == ast.KindForOfStatement && n.AsForInOrOfStatement().AwaitModifier != nil {
			nested = true
		}
		return n.ForEachChild(visit)
	}
	fn.Body().ForEachChild(visit)
	if nested {
		return nil // for await, or an await inside an awaited expression
	}
	text := rc.file.Text()
	asyncStart := strings.Index(text[nodeStart(rc.file, fn):], "async")
	if asyncStart < 0 {
		return nil
	}
	asyncStart += nodeStart(rc.file, fn)
	afterAsync := scanner.SkipTrivia(text, asyncStart+len("async"))
	// The removed shorthand `async f()` (EK4618) has no function keyword after
	// async to keep, so the declaration gets one in its place.
	keyword := ""
	if ast.IsFunctionDeclaration(fn) && !strings.HasPrefix(text[afterAsync:], "function") {
		keyword = "function "
	}
	common := []*lsproto.TextEdit{rc.textEdit(asyncStart, afterAsync, keyword)}
	if annotation := fn.Type(); annotation != nil {
		common = append(common, rc.textEdit(strings.LastIndexByte(text[:annotation.Pos()], ':'), annotation.End(), ""))
	}
	plain := slices.Clone(common)
	mapped := slices.Clone(common)
	var errorNames []string
	for _, await := range awaits {
		promise := await.Expression()
		plain = append(plain, rc.textEdit(nodeStart(rc.file, await), await.End(), wrappedCall("tryPromise", nodeText(rc.file, promise), "")))
		name := uniqueName(failureName(promise), errorNames)
		errorNames = append(errorNames, name)
		mapped = append(mapped, rc.textEdit(nodeStart(rc.file, await), await.End(), wrappedCall("tryPromise", nodeText(rc.file, promise), "(cause) => new "+name+"({ cause })")))
	}
	declarationStart := nodeStart(rc.file, fn)
	if ast.IsVariableDeclaration(fn.Parent) || ast.IsPropertyAssignment(fn.Parent) || ast.IsCallExpression(fn.Parent) || !ast.IsFunctionDeclaration(fn) {
		declarationStart = -1 // a function expression: its errors go above its statement
		for s := fn; s != nil; s = s.Parent {
			if s.Parent != nil && (ast.IsSourceFile(s.Parent) || ast.IsBlock(s.Parent)) {
				declarationStart = nodeStart(rc.file, s)
				break
			}
		}
	}
	actions := []*ls.CodeAction{{Description: "Convert to a VibeLang function", Changes: plain}}
	if len(errorNames) > 0 && declarationStart >= 0 {
		indent := lineIndent(text, declarationStart)
		var declarations strings.Builder
		for _, name := range errorNames {
			declarations.WriteString("error " + name + " { cause: unknown }\n" + indent)
		}
		mapped = append(mapped, rc.textEdit(declarationStart, declarationStart, declarations.String()))
		actions = append(actions, &ls.CodeAction{Description: "Convert to a VibeLang function with an error per await", Changes: mapped})
	}
	return actions
}

// containsAwait reports whether node holds an await outside nested functions.
func containsAwait(node *ast.Node) bool {
	if node.Kind == ast.KindAwaitExpression {
		return true
	}
	if isFunctionBoundary(node) {
		return false
	}
	return node.ForEachChild(containsAwait)
}

// failureName names the error for a rejection of promise, after the function
// it calls: fetch(url) fails with FetchFailed.
func failureName(promise *ast.Node) string {
	promise = ast.SkipParentheses(promise)
	name := "Promise"
	if ast.IsCallExpression(promise) {
		callee := promise.Expression()
		if ast.IsPropertyAccessExpression(callee) {
			callee = callee.Name()
		}
		if ast.IsIdentifier(callee) {
			name = callee.Text()
		}
	}
	runes := []rune(name)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes) + "Failed"
}

// uniqueName returns name, or name with a number when taken has it.
func uniqueName(name string, taken []string) string {
	candidate := name
	for i := 2; slices.Contains(taken, candidate); i++ {
		candidate = name + strconv.Itoa(i)
	}
	return candidate
}

// outermostPipe returns the pipe that pipe is the left side of, repeatedly.
func outermostPipe(pipe *ast.Node) *ast.Node {
	for isPipe(pipe.Parent) && pipe.Parent.AsBinaryExpression().Left == pipe {
		pipe = pipe.Parent
	}
	return pipe
}

// pipeToCalls offers to write pipe, a chain of |>, as nested calls when each
// body uses its topic once: x |> g(%) |> f(%) becomes f(g(x)). It is Effect's
// "Pipe to data-first".
func (rc *refactorContext) pipeToCalls(pipe *ast.Node) []*ls.CodeAction {
	var levels []*ast.Node // innermost first
	value := pipe
	for isPipe(value) {
		levels = append([]*ast.Node{value}, levels...)
		value = value.AsBinaryExpression().Left
	}
	text := scanner.GetTextOfNode(value)
	for _, level := range levels {
		body := level.AsBinaryExpression().Right
		topics := topicsOf(level)
		if len(topics) != 1 {
			return nil
		}
		if needsParentheses(value) && !isCallArgument(topics[0]) {
			text = "(" + text + ")"
		}
		bodyText := scanner.GetTextOfNode(body)
		offset := nodeStart(rc.file, topics[0]) - nodeStart(rc.file, body)
		text = bodyText[:offset] + text + bodyText[offset+len("%"):]
		value = body
	}
	return []*ls.CodeAction{rc.action("Convert the pipe to calls", nodeStart(rc.file, pipe), pipe.End(), text)}
}

// isCallArgument reports whether node is an argument of a call, where any
// expression stands without parentheses.
func isCallArgument(node *ast.Node) bool {
	return node.Parent != nil && ast.IsCallExpression(node.Parent) && node.Parent.Expression() != node
}

// callsToPipe offers to write call, a call whose first argument is a call,
// repeatedly, as a |> pipe: f(g(h(x))) becomes x |> h(%) |> g(%) |> f(%).
// It is Effect's "Function calls to pipe" and missedPipeableOpportunity.
func (rc *refactorContext) callsToPipe(call *ast.Node) []*ls.CodeAction {
	for call.Parent != nil && ast.IsCallExpression(call.Parent) && len(call.Parent.Arguments()) > 0 && call.Parent.Arguments()[0] == call && isPipeableCall(call.Parent) {
		call = call.Parent
	}
	var steps []*ast.Node
	for c := call; isPipeableCall(c) && len(c.Arguments()) > 0; {
		steps = append([]*ast.Node{c}, steps...)
		first := ast.SkipParentheses(c.Arguments()[0])
		if !ast.IsCallExpression(first) {
			break
		}
		c = first
	}
	if len(steps) < 2 {
		return nil
	}
	parts := []string{scanner.GetTextOfNode(steps[0].Arguments()[0])}
	for _, step := range steps {
		stepText := scanner.GetTextOfNode(step)
		first := step.Arguments()[0]
		start, end := nodeStart(rc.file, first)-nodeStart(rc.file, step), first.End()-nodeStart(rc.file, step)
		parts = append(parts, stepText[:start]+"%"+stepText[end:])
	}
	return []*ls.CodeAction{rc.action("Convert to a pipe", nodeStart(rc.file, call), call.End(), strings.Join(parts, " |> "))}
}

// isPipeableCall reports whether call is an ordinary call that a pipe step
// can write: not a hatch, a compiler helper, super, or a pipe method, and
// not a call whose first argument is a function.
func isPipeableCall(call *ast.Node) bool {
	if !ast.IsCallExpression(call) || call.Flags&ast.NodeFlagsVibeLang != 0 || hatchOf(call) != "" || isHelperCall(call) || call.Expression().Kind == ast.KindSuperKeyword || isMethodPipe(call) {
		return false
	}
	arguments := call.Arguments()
	return len(arguments) == 0 || !ast.IsFunctionLike(ast.SkipParentheses(arguments[0]))
}

// togglePipeStyle offers to write x.pipe(f, g) as pipe(x, f, g), and the
// reverse: Effect's "Toggle pipe style".
func (rc *refactorContext) togglePipeStyle(call *ast.Node) []*ls.CodeAction {
	receiver := pipeReceiver(rc.c, call)
	if receiver == nil {
		return nil
	}
	var functions []string
	for _, f := range pipeFunctions(call) {
		functions = append(functions, scanner.GetTextOfNode(f))
	}
	receiverText := scanner.GetTextOfNode(receiver)
	if isMethodPipe(call) {
		return []*ls.CodeAction{rc.action("Write pipe(x, …)", nodeStart(rc.file, call), call.End(), "pipe("+strings.Join(append([]string{receiverText}, functions...), ", ")+")")}
	}
	if needsParentheses(receiver) {
		receiverText = "(" + receiverText + ")"
	}
	return []*ls.CodeAction{rc.action("Write x.pipe(…)", nodeStart(rc.file, call), call.End(), receiverText+".pipe("+strings.Join(functions, ", ")+")")}
}
