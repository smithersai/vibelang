package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The fiber forms (D166-D170, D196-D197, D225-D228) parse into calls
// (parser/vibelang_fibers.go): `fork x` is fork(x), `join x` is $join(x), and
// `for concurrent` is $forConcurrent(...). The retired `await.all x` still
// parses, as $awaitAll(x) (and likewise allSettled, race, and any), so that
// EK1802 can rewrite it (retired_await_operations.go). The checker, the analyzer, and the
// lowering read them as those calls; this file reports what each form cannot
// mean and tells a hover what it does. A plain `await x` still parses, as
// $await(x), so that EK4609 and EK4610 can name its replacement; select
// still parses, as a labeled block around $select(...), so that EK4607 can.

var (
	// EK4601: await before a call that already runs. {0} is the call.
	EK4601 = message(4601, errorCategory, "{0} already runs here, so there is nothing to await.")
	// EK4602: await on a promise. {0} is the operand.
	EK4602 = message(4602, errorCategory, "{0} is a promise, but await in VibeLang code does not wait for promises.")
	// EK4603: await on something else. {0} is the operand's type.
	EK4603 = message(4603, errorCategory, "await in VibeLang code waits for nothing, and this is {0}.")
	// EK4604: await inside a hatch body that is not async.
	EK4604 = message(4604, errorCategory, "await in a hatch body is JavaScript's await, which needs an async function.")
	// EK1903: a break that would leave a for concurrent loop.
	EK1903 = message(1903, errorCategory, "break cannot leave a for concurrent loop: each item runs in its own fiber.")
	// EK1904: a return in the body of a for concurrent loop.
	EK1904 = message(1904, errorCategory, "return cannot leave a for concurrent loop: each item runs in its own fiber.")
	// EK4607: a select statement, replaced by try.race (D197, VIP-18).
	EK4607 = message(4607, errorCategory, "select was replaced by try.race.")
	// EK4609: await on a fiber, or an array or object of fibers (D226). {0} is the operand.
	EK4609 = message(4609, errorCategory, "await waits for a promise in JavaScript; join the fiber with join {0}.")
	// EK4610: await on a Deferred (D226). {0} is the operand.
	EK4610 = message(4610, errorCategory, "await waits for a promise in JavaScript; wait for the Deferred with {0}.await().")
	// EK4611: join on something that is not a Fiber or an array or object of them. {0} is the operand's type.
	EK4611 = message(4611, errorCategory, "join takes a Fiber or an array or object of fibers, but this is {0}.")
	// EK4612: join inside a hatch body, which is plain TypeScript.
	EK4612 = message(4612, errorCategory, "join is VibeLang syntax, but a hatch body is plain TypeScript.")
)

func init() {
	for _, m := range []*Message{EK4601, EK4602, EK4603, EK4604, EK1903, EK1904, EK4607, EK4609, EK4610, EK4611, EK4612} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkFiberForms)
	ls.RegisterQuickInfoHook(fiberFormQuickInfo)
	ls.RegisterCodeFixProvider(awaitFiberFix)
	ls.RegisterCodeFixProvider(awaitDeferredFix)
}

// fiberHelper returns the runtime helper that call, a call the parser wrote
// for a fiber form (its callee is synthesized), calls: "$await", "$join", an await
// operation's helper ("$awaitAll", "$awaitAllSettled", "$awaitRace",
// "$awaitAny"), "$select", or "$forConcurrent". It returns "" for any other
// node.
func fiberHelper(call *ast.Node) string {
	if call == nil || !ast.IsCallExpression(call) {
		return ""
	}
	callee := call.Expression()
	if callee.Kind != ast.KindIdentifier || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return ""
	}
	switch name := callee.Text(); name {
	case "$await", "$join", "$awaitAll", "$awaitAllSettled", "$awaitRace", "$awaitAny", "$select", "$forConcurrent":
		return name
	}
	return ""
}

func checkFiberForms(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		// Native async await keeps JavaScript behavior. Awaiting a Fiber or
		// Deferred does not run it, so report the configurable VIP-5 warning.
		if node.Kind == ast.KindAwaitExpression {
			operand := node.Expression()
			t := c.GetTypeAtLocation(operand)
			if t != nil {
				var m *Message
				if isJoinable(c, t, 0) {
					copy := *EK4609
					copy.Category = warningCategory
					m = &copy
				}
				if isDeferred(c, t) {
					copy := *EK4610
					copy.Category = warningCategory
					copy.Text = "await does not wait for this Deferred; use try Deferred.await({0}) in effect code."
					m = &copy
				}
				if m != nil {
					reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), m, nodeText(file, operand))
				}
			}
		}
		if fiberHelper(node) == "" && isPreludeJoin(c, node) && !inHatch(node) {
			checkJoin(c, file, node) // join(x), the keyword with a parenthesized operand (D391)
		}
		switch helper := fiberHelper(node); helper {
		case "$await":
			checkAwait(c, file, node)
		case "$join":
			checkJoin(c, file, node)
		case "$select":
			keyword := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
			note(reportAt(c, file, keyword, EK4607), "Write try.race [a(), b()] with an Effect per case; use an effect { ... } block for statements. For a default clause, poll instead: Queue.poll(queue) and an if.")
		case "$forConcurrent":
			if args := node.Arguments(); len(args) == 3 {
				checkConcurrentBody(c, args[2].Body())
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkAwait reports an await whose operand it cannot wait for.
func checkAwait(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	keyword := scanner.GetRangeOfTokenAtPosition(file, call.Pos())
	if inHatch(call) {
		note(reportAt(c, file, keyword, EK4604), "Make the function async, or move the await out of the hatch.")
		cover(c, call)
		return
	}
	args := call.Arguments()
	if len(args) != 1 || ast.NodeIsMissing(args[0]) {
		return
	}
	operand := args[0]
	if inner := ast.SkipParentheses(operand); ast.IsCallExpression(inner) && callReturnsEffect(c, inner) {
		note(reportAt(c, file, keyword, EK4601, nodeText(file, operand)), "Remove await: the call runs and waits. To run it concurrently, fork it and join the fiber.")
		cover(c, call)
		return
	}
	t := c.GetTypeAtLocation(operand)
	if t == nil {
		return
	}
	if c.GetPromisedTypeOfPromise(t) != nil {
		note(reportAt(c, file, keyword, EK4602, nodeText(file, operand)), "Wrap it in a hatch: try(async () => …) or sync(async () => …).")
		cover(c, call)
		return
	}
	switch {
	case isJoinable(c, t, 0):
		reportAt(c, file, keyword, EK4609, nodeText(file, operand))
	case isDeferred(c, t):
		reportAt(c, file, keyword, EK4610, nodeText(file, operand))
	default:
		d := reportAt(c, file, keyword, EK4603, c.TypeToString(t))
		if isEffectType(c, t) {
			note(d, "A program runs when you call it; fork it to run it concurrently, then join the fiber.")
		} else if isAwaitable(c, t, 0) {
			note(d, "Join fibers with join, and wait for each Deferred with d.await().")
		} else {
			note(d, "Remove await: a value needs no waiting.")
		}
	}
	cover(c, call)
}

// checkJoin reports a join that is in a hatch body or whose operand is not a
// Fiber or an array or object of fibers.
func checkJoin(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	keyword := scanner.GetRangeOfTokenAtPosition(file, call.Pos())
	if inHatch(call) {
		note(reportAt(c, file, keyword, EK4612), "Move the join out of the hatch.")
		cover(c, call)
		return
	}
	args := call.Arguments()
	if len(args) != 1 || ast.NodeIsMissing(args[0]) {
		return
	}
	operand := args[0]
	t := c.GetTypeAtLocation(operand)
	if t == nil || isJoinable(c, t, 0) {
		return
	}
	d := reportAt(c, file, keyword, EK4611, c.TypeToString(t))
	switch {
	case isDeferred(c, t):
		note(d, "Wait for a Deferred with {0}.await().", nodeText(file, operand))
	case c.GetPromisedTypeOfPromise(t) != nil:
		note(d, "Wrap a promise in a hatch: try(async () => …) or sync(async () => …).")
	case isEffectType(c, t) || ast.IsCallExpression(ast.SkipParentheses(operand)) && callReturnsEffect(c, ast.SkipParentheses(operand)):
		note(d, "A program runs when you call it; to run it concurrently, fork it and join the fiber.")
	}
	cover(c, call)
}

// isJoinable reports whether join can join a value of type t: a Fiber, or (at
// depth 0) an array, tuple, or object whose elements all are Fibers. An
// object's elements are its properties and the values of its index
// signatures, so Record<string, Fiber<A>> is joinable and an index signature
// that admits a number is not.
func isJoinable(c *checker.Checker, t *checker.Type, depth int) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isJoinable(c, member, depth) {
				return false
			}
		}
		return true
	}
	if c.GetPropertyOfType(t, "~effect/Fiber") != nil {
		return true
	}
	if depth > 0 || t.Flags()&checker.TypeFlagsObject == 0 || isEffectType(c, t) || isDeferred(c, t) || c.GetPromisedTypeOfPromise(t) != nil || len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) != 0 {
		return false
	}
	if checker.IsTupleType(t) {
		for _, element := range c.GetTypeArguments(t) {
			if !isJoinable(c, element, depth+1) {
				return false
			}
		}
		return true
	}
	if c.IsArrayType(t) {
		return isJoinable(c, c.GetElementTypeOfArrayType(t), depth+1)
	}
	properties := c.GetPropertiesOfType(t)
	indexes := c.GetIndexInfosOfType(t)
	if len(properties) == 0 && len(indexes) == 0 {
		return false
	}
	for _, property := range properties {
		if !isJoinable(c, c.GetTypeOfSymbol(property), depth+1) {
			return false
		}
	}
	for _, index := range indexes {
		if !isJoinable(c, index.ValueType(), depth+1) {
			return false
		}
	}
	return true
}

// isDeferred reports whether t is a Deferred.
func isDeferred(c *checker.Checker, t *checker.Type) bool {
	return c.GetPropertyOfType(t, "~effect/Deferred") != nil
}

// awaitCallAt returns the $await call whose await keyword starts at pos.
func awaitCallAt(file *ast.SourceFile, pos int) *ast.Node {
	var found *ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found != nil || node.End() < pos || node.Pos() > pos {
			return found != nil
		}
		if fiberHelper(node) == "$await" && scanner.GetRangeOfTokenAtPosition(file, node.Pos()).Pos() == pos {
			found = node
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// awaitFiberFix is EK4609's quick fix: it writes join for await.
var awaitFiberFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4609.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		text := fix.SourceFile.Text()
		if fix.Diagnostic == nil || fix.Span.End() > len(text) || text[fix.Span.Pos():fix.Span.End()] != "await" {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Join the fiber with join",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: "join"}},
		}}, nil
	},
}

// awaitDeferredFix is EK4610's quick fix: it writes `await d` as d.await().
var awaitDeferredFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4610.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || fix.LS == nil {
			return nil, nil
		}
		call := awaitCallAt(fix.SourceFile, fix.Span.Pos())
		if call == nil || len(call.Arguments()) != 1 {
			return nil, nil
		}
		operand := call.Arguments()[0]
		operandText := nodeText(fix.SourceFile, operand)
		switch ast.SkipParentheses(operand).Kind {
		case ast.KindIdentifier, ast.KindPropertyAccessExpression, ast.KindElementAccessExpression, ast.KindCallExpression, ast.KindThisKeyword:
		default:
			operandText = "(" + operandText + ")"
		}
		start := fix.Span.Pos()
		return []*ls.CodeAction{{
			Description: "Wait for the Deferred with .await()",
			Changes: []*lsproto.TextEdit{{
				Range:   fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(start, operand.End())),
				NewText: operandText + ".await()",
			}},
		}}, nil
	},
}

// awaitOperationNames maps an await operation's helper to the operation as
// written.
var awaitOperationNames = map[string]string{
	"$awaitAll":        "await.all",
	"$awaitAllSettled": "await.allSettled",
	"$awaitRace":       "await.race",
	"$awaitAny":        "await.any",
}

// callReturnsEffect reports whether call's signature returns an Effect, so
// in VibeLang code the call runs where it stands.
func callReturnsEffect(c *checker.Checker, call *ast.Node) bool {
	signature := c.GetResolvedSignature(call)
	return signature != nil && isEffectType(c, c.GetReturnTypeOfSignature(signature))
}

// isAwaitable reports whether await can wait for a value of type t: a Fiber,
// a Deferred, or (at depth 0) an array, tuple, or object whose elements all
// are Fibers or Deferreds.
func isAwaitable(c *checker.Checker, t *checker.Type, depth int) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isAwaitable(c, member, depth) {
				return false
			}
		}
		return true
	}
	if c.GetPropertyOfType(t, "~effect/Fiber") != nil || c.GetPropertyOfType(t, "~effect/Deferred") != nil {
		return true
	}
	if depth > 0 || t.Flags()&checker.TypeFlagsObject == 0 || isEffectType(c, t) || c.GetPromisedTypeOfPromise(t) != nil || len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) != 0 {
		return false
	}
	if checker.IsTupleType(t) {
		for _, element := range c.GetTypeArguments(t) {
			if !isAwaitable(c, element, depth+1) {
				return false
			}
		}
		return true
	}
	if c.IsArrayType(t) {
		return isAwaitable(c, c.GetElementTypeOfArrayType(t), depth+1)
	}
	for _, property := range c.GetPropertiesOfType(t) {
		if !isAwaitable(c, c.GetTypeOfSymbol(property), depth+1) {
			return false
		}
	}
	return true
}

// checkConcurrentBody reports a break that would leave a for concurrent loop
// (the parser flags it) and a return the body writes. The parser's own
// returns are not the body's: those that stand for a continue are
// synthesized, and the return it writes for a tail resume in a handle clause
// (parser/vibelang.go) is flagged NodeFlagsVibeLang and ends the clause.
func checkConcurrentBody(c *checker.Checker, body *ast.Node) {
	if body == nil {
		return
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case node.Kind == ast.KindBreakStatement && node.Flags&ast.NodeFlagsVibeLang != 0:
			note(report(c, node, EK1903), "Use continue to end this item, or throw to stop every item.")
			cover(c, node)
			return false
		case node.Kind == ast.KindReturnStatement && node.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) == 0:
			note(report(c, node, EK1904), "Use continue to end this item.")
			return false
		case isFunctionBoundary(node):
			return false
		}
		return node.ForEachChild(visit)
	}
	body.ForEachChild(visit)
}

// fiberFormQuickInfo tells a hover on the keyword of a fiber form what the
// form does. The parser anchors the helper's callee on the keyword, so a
// hover there finds the callee, or the call itself.
func fiberFormQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	call := node
	if call != nil && call.Parent != nil && fiberHelper(call.Parent) != "" && call.Parent.Expression() == call {
		call = call.Parent
	}
	switch fiberHelper(call) {
	case "$await":
		value := c.GetTypeAtLocation(call)
		paragraph := "Waits for the operand and returns `" + c.TypeToStringEx(value, call, hoverTypeFlags, nil) + "`."
		if signature := c.GetResolvedSignature(call); signature != nil {
			if errors := channelType(c, c.GetReturnTypeOfSignature(signature), "_E"); errors != nil && errors.Flags()&checker.TypeFlagsNever == 0 {
				paragraph += " Its failures propagate: `" + c.TypeToStringEx(errors, call, hoverTypeFlags, nil) + "`."
			}
		}
		return "await", paragraph + " In VibeLang code this is EK4609 or EK4610: join a fiber with join, and wait for a Deferred with d.await()."
	case "$join":
		value := c.GetTypeAtLocation(call)
		paragraph := "Joins the fiber, or every fiber of the array or object, keeping the shape (Fiber.join), and returns `" + c.TypeToStringEx(value, call, hoverTypeFlags, nil) + "`. A failure interrupts the rest."
		if signature := c.GetResolvedSignature(call); signature != nil {
			if errors := channelType(c, c.GetReturnTypeOfSignature(signature), "_E"); errors != nil && errors.Flags()&checker.TypeFlagsNever == 0 {
				paragraph += " Its failures propagate: `" + c.TypeToStringEx(errors, call, hoverTypeFlags, nil) + "`."
			}
		}
		return "join", paragraph
	case "$select":
		return "select", "Replaced by try.race (EK4607)."
	case "$forConcurrent":
		return "for concurrent", "Runs the body for each item in its own fiber and joins them all before the loop ends; a failure interrupts the rest."
	}
	return "", ""
}
