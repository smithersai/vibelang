package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
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
	EK1906 = message(parser.ConcurrentHeadDiagnosticCode, errorCategory, parser.ConcurrentHeadDiagnosticText)
	// EK4601: await before a call that already runs. {0} is the call.
	EK4601 = message(4601, errorCategory, "{0} already runs here, so there is nothing to await.")
	// EK4602: await on a promise. {0} is the operand.
	EK4602 = message(4602, errorCategory, "{0} is a promise, but await in VibeLang code does not wait for promises.")
	// EK4603: await on something else. {0} is the operand's type.
	EK4603 = message(4603, errorCategory, "await in VibeLang code waits for nothing, and this is {0}.")
	// EK4604: await inside a hatch body that is not async.
	EK4604 = message(4604, errorCategory, "await in a hatch body is JavaScript's await, which needs an async function.")
	// EK1903: a break that would leave a for concurrent loop.
	EK1903 = message(1903, errorCategory, "break cannot leave a for concurrent loop.")
	// EK1904: a return in the body of a for concurrent loop.
	EK1904 = message(1904, errorCategory, "return cannot leave a for concurrent loop.")
	// EK4607: a select statement, replaced by try.race (D197, VIP-18).
	EK4607 = message(4607, errorCategory, "select is outside the first release; vibelang --fix refuses an unproved selection rewrite. Choose explicit Effect selection for the intended behavior.")
	// EK4609: native await on a Fiber (VIP-5). {0} is the operand.
	EK4609 = message(4609, warningCategory, "await does not wait for this Fiber; use await runPromise(Fiber.join({0})).")
	// EK4610: await on a Deferred (D226). {0} is the operand.
	EK4610 = message(4610, warningCategory, "await does not wait for this Deferred; use await runPromise(Deferred.await({0})).")
	// EK1704: join on something that is not a Fiber or an array or object of them. {0} is the operand's type.
	EK1704 = message(1704, errorCategory, "join takes a Fiber, but this is {0}.")
	// EK4612: join inside a hatch body, which is plain TypeScript.
	EK4612 = message(4612, errorCategory, "join is VibeLang syntax, but a hatch body is plain TypeScript.")
)

// isConcurrentBody reports whether fn is the body of a for concurrent loop,
// the program arrow the parser writes as the third argument of $forConcurrent
// (parser/vibelang_fibers.go). It is not an activation of its own: a yield in
// it emits from the producer around the loop (chapter 2, Producers), which
// the checker learns through the transparent yield hook.
func isConcurrentBody(fn *ast.Node) bool {
	return fn != nil && fn.Kind == ast.KindArrowFunction && fn.Flags&ast.NodeFlagsVibeLang != 0 && fiberHelper(fn.Parent) == "$forConcurrent"
}

func init() {
	checker.RegisterTransparentYieldFunctionHook(isConcurrentBody)
	// A do or match the parser still writes as a function called in place
	// is no function boundary for labels (chapter 2, Region bodies).
	checker.RegisterLabelTransparentFunctionHook(isCalledInPlace)
	for _, m := range []*Message{EK4601, EK4602, EK4603, EK4604, EK1903, EK1904, EK1906, EK4607, EK4609, EK4610, EK1704, EK4612} {
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
	case "$await", "$join", "$awaitAll", "$awaitAllSettled", "$awaitRace", "$awaitAny", "$select", "$forConcurrent", "$forkIn", "$forkScoped", "$forkDetach":
		return name
	}
	return ""
}

func checkFiberForms(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		// VIP-17 placement precedes operand typing. Inspect the parser's
		// operator marker so ordinary helpers in plain code stay ordinary.
		if isFiberOperator(node) && !inEffectCode(node) {
			reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK1701)
			return node.ForEachChild(visit)
		}
		// Native async await keeps JavaScript behavior. Awaiting a Fiber or
		// Deferred does not run it, so report the configurable VIP-5 warning.
		if node.Kind == ast.KindAwaitExpression {
			operand := node.Expression()
			t := c.GetTypeAtLocation(operand)
			if t != nil {
				var m *Message
				if nativeAwaitAdvisoryTarget(c, t, "Fiber") {
					m = EK4609
				}
				if nativeAwaitAdvisoryTarget(c, t, "Deferred") {
					m = EK4610
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
		case "$forkIn", "$forkScoped", "$forkDetach":
			checkForkOwner(c, file, node)
		case "$select":
			// The parser reports EK4607; retain only recovery coverage here.
			// The retired form's case programs have no typing to check
			// against: hide TypeScript's argument errors, such as a case
			// head that gives an Effect where $select expects a program.
			region := node
			if block := ast.FindAncestor(node, ast.IsLabeledStatement); block != nil {
				region = block // the labeled block the parser writes around $select
			}
			coverCodes(c, region, 2345)
		case "$forConcurrent":
			if !inEffectCode(node) {
				// A plain function runs no Effect (VIP-1, VIP-19).
				note(reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK1902), "Mark the function effect, or loop with for...of.")
				for _, arg := range node.Arguments() {
					coverArgument(c, arg) // the item function is no Effect function here
				}
			}
			if args := node.Arguments(); len(args) == 3 {
				checkConcurrentOperand(c, args[0])
				checkConcurrentLimit(c, file, args[1])
				checkConcurrentBody(c, args[2].Body())
				for _, parameter := range args[2].Parameters() {
					checkConcurrentBody(c, parameter.Name())
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkConcurrentOperand gives the source loop's operand diagnostic instead
// of leaking the synthesized helper's argument error. Its contextual Iterable
// domain retains ordinary assignability, including any and never. Erase its
// inferred element arguments: a valid union of iterables can otherwise fail
// helper inference without failing the Iterable operand test.
func checkConcurrentOperand(c *checker.Checker, operand *ast.Node) {
	if ast.NodeIsMissing(operand) {
		return
	}
	actual := c.GetTypeAtLocation(operand)
	expected := c.GetContextualType(operand, checker.ContextFlagsNone)
	if actual == nil || expected == nil || expected.Flags()&checker.TypeFlagsObject == 0 || expected.ObjectFlags()&checker.ObjectFlagsReference == 0 {
		return
	}
	arguments := c.GetTypeArguments(expected)
	domain := make([]*checker.Type, len(arguments))
	for i := range domain {
		domain[i] = c.GetAnyType()
	}
	expected = c.NewTypeReference(expected.Target(), domain)
	if c.IsTypeAssignableTo(actual, expected) {
		return
	}
	report(c, operand, EK1901)
	// Only the outer argument mismatch is explained. Keep an inner call's
	// argument errors and every independent diagnostic in the loop body.
	coverArgument(c, operand)
	coverArgument(c, ast.SkipParentheses(operand))
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
	// VIP-1/VIP-5: placement forbids every operand in effect code. Keep
	// the handle-specific repair notes without the retired await codes.
	if inEffectCode(call) || inEffectParameterInitialization(call) {
		d := reportAt(c, file, keyword, EK0102)
		if t := c.GetTypeAtLocation(args[0]); t != nil {
			switch {
			case isJoinable(c, t, 0):
				note(d, "Join the fiber with join {0}.", nodeText(file, args[0]))
			case isDeferred(c, t):
				note(d, "Wait for the Deferred with try Deferred.await({0}).", nodeText(file, args[0]))
			}
		}
		cover(c, call)
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
		note(reportAt(c, file, keyword, EK0102), "Join the fiber with join {0}.", nodeText(file, operand))
	case isDeferred(c, t):
		note(reportAt(c, file, keyword, EK0102), "Wait for the Deferred with try Deferred.await({0}).", nodeText(file, operand))
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
// Fiber.
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
	// TypeScript assigns any and never to the Fiber operand domain.
	if t != nil && (t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 ||
		!c.CompilerOptions().GetStrictOptionValue(c.CompilerOptions().StrictNullChecks) &&
			t.Flags()&(checker.TypeFlagsNull|checker.TypeFlagsUndefined) != 0) {
		return
	}
	if t == nil || isJoinable(c, t, 1) || analyzerFor(c).joinsRejectedFork(operand) {
		return
	}
	d := reportAt(c, file, keyword, EK1704, c.TypeToString(t))
	switch {
	case nativeAwaitTarget(c, t, "Deferred"):
		note(d, "Wait for the Deferred with try Deferred.await({0}).", nodeText(file, operand))
	case c.GetPromisedTypeOfPromise(t) != nil:
		note(d, "Wrap the Promise with try Effect.tryPromise(() => {0}).", nodeText(file, operand))
	case isEffectOperandType(c, t):
		note(d, "Run the Effect with try {0}.", nodeText(file, operand))
	}
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
	// Native assignability handles constraints as well as structural members.
	// Use the same erased channels as the operand domain in VIP-17.
	for _, file := range c.Program().SourceFiles() {
		if !isEffectModuleFile(file, "Fiber") || file.Symbol == nil {
			continue
		}
		for _, symbol := range c.GetExportsOfModule(file.Symbol) {
			if symbol.Name() == "Fiber" && symbol.Flags()&ast.SymbolFlagsInterface != 0 {
				target := c.GetDeclaredTypeOfSymbol(symbol)
				any := c.GetAnyType()
				if c.IsTypeAssignableTo(t, c.NewTypeReference(target, []*checker.Type{any, any})) {
					return true
				}
			}
		}
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

// awaitFiberFix repairs EK4609 and the Fiber form of EK0102 with join.
var awaitFiberFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4609.Code, EK0102.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.ErrorCode == EK4609.Code {
			return nativeAwaitBridgeFix(ctx, fix, "Fiber")
		}
		text := fix.SourceFile.Text()
		if fix.Diagnostic == nil || fix.Span.End() > len(text) || text[fix.Span.Pos():fix.Span.End()] != "await" {
			return nil, nil
		}
		if fix.ErrorCode == EK0102.Code {
			call := awaitCallAt(fix.SourceFile, fix.Span.Pos())
			if call == nil || len(call.Arguments()) != 1 {
				return nil, nil
			}
			c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
			defer done()
			if typ := c.GetTypeAtLocation(call.Arguments()[0]); typ == nil || !isJoinable(c, typ, 0) {
				return nil, nil
			}
			operand := call.Arguments()[0]
			if rewrite := legacyCollectionRewrite(c, fix.SourceFile, call, operand); rewrite.fixable() {
				var changes []*lsproto.TextEdit
				for _, edit := range rewrite.edits {
					changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
				}
				return []*ls.CodeAction{{Description: "Join the fibers in the collection", Changes: changes}}, nil
			}
			if ast.IsCallExpression(ast.SkipParentheses(operand)) {
				// Parentheses also handle contextual keyword callees such as get.
				operandText := strings.TrimSpace(text[fix.Span.End():operand.End()])
				return []*ls.CodeAction{{
					Description: "Join the fiber with join",
					Changes: []*lsproto.TextEdit{{
						Range:   fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(fix.Span.Pos(), operand.End())),
						NewText: "join (" + operandText + ")",
					}},
				}}, nil
			}
		}
		return []*ls.CodeAction{{
			Description: "Join the fiber with join",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: "join"}},
		}}, nil
	},
}

// awaitDeferredFix repairs EK4610 and the Deferred form of EK0102.
var awaitDeferredFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4610.Code, EK0102.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.ErrorCode == EK4610.Code {
			return nativeAwaitBridgeFix(ctx, fix, "Deferred")
		}
		if fix.Diagnostic == nil || fix.LS == nil {
			return nil, nil
		}
		call := awaitCallAt(fix.SourceFile, fix.Span.Pos())
		if call == nil || len(call.Arguments()) != 1 {
			return nil, nil
		}
		operand := call.Arguments()[0]
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		if typ := c.GetTypeAtLocation(operand); typ == nil || !isDeferred(c, typ) {
			return nil, nil
		}
		// Keep comments between await and its operand inside the replacement.
		operandText := strings.TrimSpace(fix.SourceFile.Text()[fix.Span.End():operand.End()])
		namespace := "Deferred"
		var imports []*lsproto.TextEdit
		symbol := c.ResolveName(namespace, operand, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace, false)
		available := symbol != nil && c.GetTypeOnlyAliasDeclaration(symbol) == nil
		if available && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if !available || symbol != effectModuleNamespace(c, fix.SourceFile, "Deferred") {
			namespace = (&freshNames{file: fix.SourceFile}).freshName("Deferred")
			imports = schemaFlagHeader(fix, "import { Deferred as "+namespace+" } from \"effect\";\n")
		}
		start := fix.Span.Pos()
		edits := []*lsproto.TextEdit{{
			Range:   fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(start, operand.End())),
			NewText: "try " + namespace + ".await(" + operandText + ")",
		}}
		edits = append(edits, imports...)
		return []*ls.CodeAction{{
			Description: "Wait for the Deferred with try Deferred.await",
			Changes:     edits,
		}}, nil
	},
}

// A generic constraint can hide the same union that a generic join/await
// call cannot infer. Intersections preserve the constraint's ambiguity too.
func nativeAwaitBridgeHasUnion(c *checker.Checker, value *checker.Type) bool {
	value = c.GetApparentType(value)
	if value.Flags()&checker.TypeFlagsUnion != 0 {
		return true
	}
	if value.Flags()&checker.TypeFlagsIntersection != 0 {
		for _, member := range value.Types() {
			if nativeAwaitBridgeHasUnion(c, member) {
				return true
			}
		}
	}
	return false
}

// nativeAwaitBridgeFix preserves JavaScript suspension and evaluates the
// operand once. Import fresh bindings even when the prelude is disabled or
// the source shadows Effect, Fiber, Deferred, or runPromise (VIP-1/VIP-5).
func nativeAwaitBridgeFix(ctx context.Context, fix *ls.CodeFixContext, module string) ([]*ls.CodeAction, error) {
	if fix.Diagnostic == nil || fix.LS == nil {
		return nil, nil
	}
	var await *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.End() < fix.Span.Pos() || node.Pos() > fix.Span.Pos() {
			return false
		}
		if node.Kind == ast.KindAwaitExpression && scanner.GetRangeOfTokenAtPosition(fix.SourceFile, node.Pos()).Pos() == fix.Span.Pos() {
			await = node
			return true
		}
		return node.ForEachChild(visit)
	}
	fix.SourceFile.AsNode().ForEachChild(visit)
	if await == nil {
		return nil, nil
	}
	operand := await.Expression()
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	// A same-kind union can warrant a warning without being accepted by
	// one generic join/await call. Never offer an edit that adds an error.
	value := c.GetTypeAtLocation(operand)
	if value == nil || nativeAwaitBridgeHasUnion(c, value) || !nativeAwaitTarget(c, value, module) {
		return nil, nil
	}
	names := &freshNames{file: fix.SourceFile}
	runner := names.freshName("$awaitRunPromise")
	helper, operation, description := names.freshName("$awaitJoin"), "join", "Join the fiber with await runPromise"
	if module == "Deferred" {
		helper, operation, description = names.freshName("$awaitDeferred"), "await", "Wait for the Deferred with await runPromise"
	}
	operandText := strings.TrimSpace(fix.SourceFile.Text()[fix.Span.End():operand.End()])
	edits := []*lsproto.TextEdit{{
		Range:   fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(fix.Span.Pos(), await.End())),
		NewText: "await " + runner + "(" + helper + "(" + operandText + "))",
	}}
	edits = append(edits, schemaFlagHeader(fix, "import { runPromise as "+runner+" } from \"effect/Effect\";\nimport { "+operation+" as "+helper+" } from \"effect/"+module+"\";\n")...)
	return []*ls.CodeAction{{Description: description, Changes: edits}}, nil
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

// checkConcurrentBody reports a break or labeled continue that would leave a
// for concurrent item, and a return the body writes. The parser's own
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
		case node.Kind == ast.KindContinueStatement && concurrentContinueEscapes(node, body):
			note(report(c, node, EK1905), "Use continue at the item level to end this item, or throw to stop every item.")
			coverCodes(c, node, 1107)
			return false
		case node.Kind == ast.KindBreakStatement && node.Flags&ast.NodeFlagsVibeLang != 0:
			note(report(c, node, EK1903), "Use continue to end this item, or throw to stop every item.")
			cover(c, node)
			return false
		case node.Kind == ast.KindBreakStatement && concurrentBreakEscapes(node, body):
			note(report(c, node, EK1903), "Use continue to end this item, or throw to stop every item.")
			coverCodes(c, node, 1107)
			return false
		case node.Kind == ast.KindReturnStatement && node.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) == 0 && isReturnKeyword(ast.GetSourceFileOfNode(body), node):
			note(report(c, node, EK1904), "Use continue to end this item.")
			return false
		}
		return concurrentItemChildren(ast.GetSourceFileOfNode(body), node, visit)
	}
	body.ForEachChild(visit)
}

// concurrentBreakEscapes reports whether a labeled break names a statement
// outside the item, the for concurrent itself included: the break would leave
// the loop from the item's callback. Labels inside the item keep TypeScript's
// ordinary behavior; unresolved labels and jumps across a written function
// keep its diagnostics.
func concurrentBreakEscapes(node, body *ast.Node) bool {
	label := node.Label()
	if label == nil {
		return false
	}
	file := ast.GetSourceFileOfNode(body)
	outside := false
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if parent == body {
			outside = true
		}
		// A for try inside the item reports its own outward jump (EK2003).
		if !outside && isForTry(parent) {
			return false
		}
		if ast.IsFunctionLikeOrClassStaticBlockDeclaration(parent) {
			// A do expression's arrow is not a source function. A nested
			// item's closure, met before leaving this body, makes the break
			// that item's to report.
			if isDoArrow(file, parent) || ast.IsArrowFunction(parent) && fiberHelper(parent.Parent) == "$forConcurrent" && outside {
				continue
			}
			return false
		}
		if parent.Kind == ast.KindLabeledStatement && parent.Label().Text() == label.Text() {
			return outside
		}
	}
	return false
}

// concurrentContinueEscapes resolves the written label across the synthetic
// item closure. Labels inside the item keep TypeScript's ordinary behavior;
// unresolved labels and jumps across a written function keep its diagnostics.
func concurrentContinueEscapes(node, body *ast.Node) bool {
	label := node.Label()
	if label == nil {
		return false
	}
	outside := false
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if parent == body {
			outside = true
		}
		if ast.IsFunctionLikeOrClassStaticBlockDeclaration(parent) {
			if ast.IsArrowFunction(parent) && fiberHelper(parent.Parent) == "$forConcurrent" {
				continue
			}
			return false
		}
		if parent.Kind == ast.KindLabeledStatement && parent.Label().Text() == label.Text() {
			target := parent.Statement()
			for ast.IsLabeledStatement(target) {
				target = target.Statement()
			}
			// A source label on this item stays within it. Generated head
			// and limit blocks do not change the source loop it names.
			if call := parser.VibeLangConcurrentCall(target); call != nil {
				return outside && call != body.Parent.Parent
			}
			return outside && ast.IsIterationStatement(target, false /*lookInLabeledStatements*/)
		}
	}
	return false
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
		paragraph := "Runs Fiber.join on the fiber and returns `" + c.TypeToStringEx(value, call, hoverTypeFlags, nil) + "`, or propagates its failure."
		if signature := c.GetResolvedSignature(call); signature != nil {
			if errors := channelType(c, c.GetReturnTypeOfSignature(signature), "_E"); errors != nil && errors.Flags()&checker.TypeFlagsNever == 0 {
				paragraph += " Its failures propagate: `" + c.TypeToStringEx(errors, call, hoverTypeFlags, nil) + "`."
			}
		}
		return "join", paragraph
	case "$forkIn":
		return "fork.in", "Starts a fiber that the given Scope owns, and gives its Fiber (Effect.forkIn)."
	case "$forkScoped":
		return "fork.scoped", "Starts a fiber that the current Scope owns, and gives its Fiber (Effect.forkScoped)."
	case "$forkDetach":
		return "fork.detached", "Starts a fiber that nothing owns, and gives its Fiber (Effect.forkDetach)."
	case "$select":
		return "select", "Replaced by try.race (EK4607)."
	case "$forConcurrent":
		return "for concurrent", "Runs Effect.forEach with the loop's concurrency limit. Numeric limits at or below 1 run the items sequentially on the enclosing fiber. All items join before the loop ends; a failure interrupts the rest."
	}
	return "", ""
}

// Test assignability against the pinned interface, rather than legacy
// aggregate-join or marker-property detection. A repair must typecheck.
func nativeAwaitTarget(c *checker.Checker, value *checker.Type, module string) bool {
	if value == nil || value.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsNever) != 0 {
		return false
	}
	for _, file := range c.Program().SourceFiles() {
		if !isEffectModuleFile(file, module) || file.Symbol == nil {
			continue
		}
		for _, export := range c.GetExportsOfModule(file.Symbol) {
			if export.Name() != module || export.Flags()&ast.SymbolFlagsInterface == 0 {
				continue
			}
			target := c.GetDeclaredTypeOfSymbol(export)
			// Deferred's channels are invariant. Instantiating them with any
			// rejects Deferred<number, never> under strictFunctionTypes.
			channels := nativeAwaitChannels(c, value, module)
			return channels != nil && c.IsTypeAssignableTo(value, c.NewTypeReference(target, channels))
		}
	}
	return false
}

// Read the channels before checking the entire pinned interface: a marker
// alone is insufficient, but its declared variance retains invariant arguments.
func nativeAwaitChannels(c *checker.Checker, value *checker.Type, module string) []*checker.Type {
	variance := c.GetTypeOfPropertyOfType(value, "~effect/"+module)
	if variance == nil {
		return nil
	}
	channels := make([]*checker.Type, 0, 2)
	for _, name := range []string{"_A", "_E"} {
		channel := c.GetTypeOfPropertyOfType(variance, name)
		if channel == nil {
			return nil
		}
		signatures := c.GetSignaturesOfType(channel, checker.SignatureKindCall)
		if len(signatures) != 1 {
			return nil
		}
		channels = append(channels, c.GetReturnTypeOfSignature(signatures[0]))
	}
	return channels
}

// Every union alternative can be the same handle kind with different
// invariant channel arguments. Warning admission does not promise that
// one generic bridge call can accept the entire union.
func nativeAwaitAdvisoryTarget(c *checker.Checker, t *checker.Type, module string) bool {
	if t == nil {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !nativeAwaitAdvisoryTarget(c, member, module) {
				return false
			}
		}
		return true
	}
	return nativeAwaitTarget(c, t, module)
}
