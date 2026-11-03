package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// EK4401's quick fix writes a call of a plain TypeScript function that nothing
// says the exceptions of, keeping what TypeScript meant by it. A migration
// meets one wherever a .vibe module calls a .ts one (VIP-4: a foreign callable
// throws unknown unless annotated).
//
// In Effect TypeScript an exception such a call throws in a generator is a
// defect, with the value that was thrown, and adds nothing to E. So in effect
// code the call goes through Effect's own wrapper, which is what VIP-4 requires,
// and Effect.orDie keeps the exception a defect and the declaration as it was:
//
//	const kind = Dialect.integer(sql)
//	const kind = try Effect.orDie(Effect.try({ try: () => Dialect.integer(sql), catch: (error) => error }))
//
// Listing the function in trustedPackages or in trusted(impl, []) would say the
// same to the compiler, but on no evidence: trust is a claim about the code,
// for someone who read it, and its reach is every later call. An operand that
// runs an Effect moves to a const before the statement, when that keeps the
// order of what runs: the wrapper's function is plain.
//
// A function with no Effect operation is plain in TypeScript, and its calls are
// JavaScript calls, which VIP-4 allows when nothing says they throw. Without a
// return annotation it would compile to an Effect (D500), so it gets : infer _,
// which keeps its type. A call whose @throws says it may throw, a class this
// file can't reach included, can't stay in plain code (EK0401: synchronous
// VibeLang code never throws), so its function becomes effect code and the
// call goes through Effect.try like the others. A call that returns a Promise has no such fix: it is
// a value in the generator, and tryPromise would wait for it.
//
// The wrapper's function also loses what control flow proved about a property:
// in `o.p ? f(o.p) : 0`, o.p is a string outside the function and possibly
// undefined inside it. A guard in the same expression moves into the function
// with the call. A guard in an earlier statement keeps its proof in a const
// before the statement, when nothing runs before the read.

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK4401.Code)
	ls.RegisterCodeFixProvider(foreignCallFix)
}

// foreignCallFix is EK4401's quick fix.
var foreignCallFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4401.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		callee := tsFormNodeAt(fix.SourceFile, fix.Span, isCallee)
		if callee == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		rewrite := planForeignCall(c, fix.SourceFile, callee.Parent)
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

// planForeignCall plans EK4401's fix for call, or returns nil.
func planForeignCall(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !ast.IsCallExpression(call) || call.Flags&ast.NodeFlagsVibeLangTry != 0 {
		return nil
	}
	if !needsBoundary(c, file, call) {
		return nil
	}
	fn := enclosingFunction(call)
	if fn == nil || fn.BodyData() == nil || fn.BodyData().AsteriskToken != nil {
		return nil // a generator's Effect.gen is fixed first
	}
	// The outermost foreign call's wrapper holds the calls in its operands.
	for n := call.Parent; n != nil && n != fn; n = n.Parent {
		if ast.IsCallExpression(n) && n.Expression() != call && needsBoundary(c, file, n) {
			return nil
		}
	}
	a := analyzerFor(c)
	if returnsEffectGen(c, fn) {
		return nil // what fn is follows from the program it returns, written first
	}
	if a.staysPlain(fn) && a.knownThrows(call) == nil {
		at := returnTypePosition(file, fn)
		if at < 0 {
			return nil
		}
		return &formRewrite{edits: []sourceEdit{{at, at, ": infer _"}}, description: "the function plain"}
	}
	target := call
	guard := outermostGuardedExpression(call)
	if guard != nil && holdsNarrowedForeignCall(c, file, guard) {
		if a.runsVibeLang(guard) {
			return nil // a try cannot run inside the wrapper's function
		}
		target = guard
	}
	var inputs []boundaryInput
	code := ""
	if target == call {
		narrowed := func(operand *ast.Node) bool { return readsNarrowedProperty(c, operand) }
		inputs, code = boundaryInputs(c, file, call, narrowed)
	} else {
		code = nodeText(file, target)
	}
	var edits []sourceEdit
	if len(inputs) > 0 {
		statement := enclosingStatement(call)
		if statement == nil || a.runsOutOfOrder(statement, call, inputs) {
			return nil
		}
		for _, in := range inputs {
			if readsNarrowedProperty(c, in.node) && runsBefore(statement, in.node) {
				return nil // the call that runs first could change the property
			}
		}
		at := nodeStart(file, statement)
		text := ""
		for _, declaration := range inputConsts(inputs) {
			text += strings.TrimSuffix(declaration, "; ") + "\n" + lineIndent(file.Text(), at)
		}
		edits = append(edits, sourceEdit{at, at, text})
	}
	if !isMarkedEffect(fn) && (ast.IsArrowFunction(fn) || ast.IsFunctionExpression(fn)) {
		edits = append(edits, sourceEdit{nodeStart(file, fn), nodeStart(file, fn), "effect "}) // try needs effect code
	}
	wrapped := "try Effect.orDie(Effect.try({ try: () => " + code + ", catch: (error) => error }))"
	if !standsAlone(target) {
		wrapped = "(" + wrapped + ")"
	}
	edits = append(edits, sourceEdit{nodeStart(file, target), target.End(), wrapped})
	return &formRewrite{edits: edits, description: "the call through Effect.try, whose exceptions stay defects"}
}

// outermostGuardedExpression returns the outermost conditional or logical
// expression around node in its statement, or nil.
func outermostGuardedExpression(node *ast.Node) *ast.Node {
	var guard *ast.Node
	for n := node.Parent; n != nil && !ast.IsStatement(n) && !ast.IsFunctionLike(n); n = n.Parent {
		if ast.IsConditionalExpression(n) || ast.IsBinaryExpression(n) && ast.IsLogicalOrCoalescingBinaryOperator(n.AsBinaryExpression().OperatorToken.Kind) {
			guard = n
		}
	}
	return guard
}

// holdsNarrowedForeignCall reports whether a call EK4401 reports, in
// expression, reads a property whose type control flow narrowed.
func holdsNarrowedForeignCall(c *checker.Checker, file *ast.SourceFile, expression *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if ast.IsCallExpression(n) && needsBoundary(c, file, n) && readsNarrowedProperty(c, n) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(expression)
}

// readsNarrowedProperty reports whether node reads, outside the functions it
// defines, a property whose declared type is wider than its type there: what a
// function written around the read would not know.
func readsNarrowedProperty(c *checker.Checker, node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if ast.IsPropertyAccessExpression(n) {
			if symbol := c.GetSymbolAtLocation(n.Name()); symbol != nil && symbol.Flags()&(ast.SymbolFlagsProperty|ast.SymbolFlagsAccessor) != 0 {
				if here, declared := c.GetTypeAtLocation(n), c.GetTypeOfSymbol(symbol); here != nil && declared != nil && !c.IsTypeAssignableTo(declared, here) {
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(node)
}

// runsBefore reports whether statement makes a call before it reaches node.
func runsBefore(statement, node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.End() <= node.Pos() && isInvocation(n) {
			return true
		}
		if n.Pos() >= node.Pos() || isFunctionBoundary(n) {
			return false
		}
		return n.ForEachChild(visit)
	}
	return statement.ForEachChild(visit)
}

// needsBoundary reports whether call is a synchronous call EK4401 reports: one
// nothing says the exceptions of, or one whose @throws names a class this file
// cant reach, which cant join E as a typed failure.
func needsBoundary(c *checker.Checker, file *ast.SourceFile, call *ast.Node) bool {
	t := callTrust(c, call)
	switch {
	case t.promise, returnsEffectful(c, call):
		return false
	case t.kind == trustForeign:
		return true
	case t.kind != trustTagged:
		return false
	case t.unreachable != "":
		return true
	}
	return slices.ContainsFunc(t.failures, func(f failure) bool {
		_, _, ok := reachClass(c, file, f)
		return !ok
	})
}

// staysPlain reports whether fn, a function with no written form, has no
// Effect operation of its own and no destination that asks for an Effect.
func (a *analyzer) staysPlain(fn *ast.Node) bool {
	if isMarkedEffect(fn) || fn.Type() != nil || isProducer(fn) || !isLowerable(fn) || a.expectsEffect(fn) || a.destinationTakesProgram(fn) {
		return false
	}
	return !a.forEachRunningCallInBody(fn, a.performs) && !hasVibeLangStatement(fn) && !hasEscapingThrow(fn) && !declaresUsing(fn) && !a.hasStreamLoop(fn) && !a.returnsProgram(fn)
}

// destinationTakesProgram reports whether fn, a function expression, stands
// where its contextual type returns an Effect, as in { reduce: (s) => … } for
// reduce: (s: S) => Effect<S>. Its body is the program's, which an earlier fix
// may have left with no Effect operation.
func (a *analyzer) destinationTakesProgram(fn *ast.Node) bool {
	if !ast.IsArrowFunction(fn) && !ast.IsFunctionExpression(fn) {
		return false
	}
	contextual := a.checker.GetContextualType(fn, checker.ContextFlagsNone)
	if contextual == nil {
		return false
	}
	return slices.ContainsFunc(a.checker.GetSignaturesOfType(contextual, checker.SignatureKindCall), func(signature *checker.Signature) bool {
		return holdsEffectValue(a.checker, a.checker.GetReturnTypeOfSignature(signature))
	})
}

// returnsProgram reports whether a value fn returns is an Effect.
func (a *analyzer) returnsProgram(fn *ast.Node) bool {
	isProgram := func(expr *ast.Node) bool {
		t := a.checker.GetTypeAtLocation(expr)
		return t != nil && holdsEffectValue(a.checker, t)
	}
	body := fn.Body()
	if !ast.IsBlock(body) {
		return isProgram(body)
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsReturnStatement(node) && node.Expression() != nil && isProgram(node.Expression()) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return body.ForEachChild(visit)
}

// returnTypePosition is where fn's return annotation goes: after the
// parenthesis that closes its parameters, or -1 for an arrow with a bare
// parameter, which has none.
func returnTypePosition(file *ast.SourceFile, fn *ast.Node) int {
	text := file.Text()
	end := nodeStart(file, fn)
	if parameters := fn.Parameters(); len(parameters) > 0 {
		end = parameters[len(parameters)-1].End()
	} else if tp := fn.TypeParameters(); tp != nil && len(tp) > 0 {
		end = tp[len(tp)-1].End()
	}
	at := strings.IndexByte(text[end:], ')')
	if at < 0 || at >= nodeStart(file, fn.Body())-end {
		return -1
	}
	return end + at + 1
}

// enclosingStatement returns the statement of a block that holds node, within
// node's function, or nil.
func enclosingStatement(node *ast.Node) *ast.Node {
	for n := node; n.Parent != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			return nil
		}
		if ast.IsStatement(n) && ast.IsBlock(n.Parent) {
			return n
		}
	}
	return nil
}

// runsOutOfOrder reports whether moving inputs of call before statement would
// change what runs: call stands in a branch or a callback, or something that
// runs comes first in statement.
func (a *analyzer) runsOutOfOrder(statement, call *ast.Node, inputs []boundaryInput) bool {
	switch {
	case ast.IsIfStatement(statement), ast.IsSwitchStatement(statement):
		if !ast.IsNodeDescendantOf(call, statement.Expression()) {
			return true // a branch runs only sometimes
		}
	case !ast.IsVariableStatement(statement) && !ast.IsExpressionStatement(statement) && !ast.IsReturnStatement(statement) && !ast.IsThrowStatement(statement):
		return true // a loop runs its head each time; the const would run once
	}
	for n := call.Parent; n != statement; n = n.Parent {
		switch {
		case ast.IsConditionalExpression(n), ast.IsFunctionLike(n):
			return true
		case ast.IsBinaryExpression(n) && ast.IsLogicalOrCoalescingBinaryOperator(n.AsBinaryExpression().OperatorToken.Kind):
			return true
		}
	}
	first := inputs[0].node.Pos()
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Pos() >= first || isFunctionBoundary(n) {
			return false
		}
		if n.End() <= first && a.runsVibeLang(n) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return statement.ForEachChild(visit)
}

// standsAlone reports whether a try can replace node with no parentheses:
// not as an operand or a receiver.
func standsAlone(node *ast.Node) bool {
	parent := node.Parent
	switch {
	case ast.IsPropertyAccessExpression(parent), ast.IsElementAccessExpression(parent), ast.IsCallExpression(parent), ast.IsNonNullExpression(parent):
		return parent.Expression() != node
	case ast.IsConditionalExpression(parent):
		return parent.AsConditionalExpression().Condition != node
	case ast.IsBinaryExpression(parent), ast.IsPrefixUnaryExpression(parent), ast.IsPostfixUnaryExpression(parent), ast.IsAsExpression(parent), ast.IsSatisfiesExpression(parent),
		ast.IsAwaitExpression(parent), ast.IsTypeOfExpression(parent), ast.IsVoidExpression(parent), ast.IsDeleteExpression(parent), ast.IsTaggedTemplateExpression(parent):
		return false
	}
	return true
}

// returnsEffectGen reports whether a value fn returns is an Effect.gen call.
func returnsEffectGen(c *checker.Checker, fn *ast.Node) bool {
	var isGen func(expr *ast.Node) bool
	isGen = func(expr *ast.Node) bool {
		value := ast.SkipParentheses(expr)
		if ast.IsConditionalExpression(value) {
			conditional := value.AsConditionalExpression()
			return isGen(conditional.WhenTrue) || isGen(conditional.WhenFalse)
		}
		return ast.IsCallExpression(value) && isEffectFunction(c, value.Expression(), "Effect", "gen")
	}
	body := fn.Body()
	if !ast.IsBlock(body) {
		return isGen(body)
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsReturnStatement(node) && node.Expression() != nil && isGen(node.Expression()) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return body.ForEachChild(visit)
}
