package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Synchronous VibeLang code never throws (Will, 2026-10-31: "If you throw in
// vibelang itself in a sync function that's an error."). A throw statement is
// EK0401 everywhere except in effect code, where it is Effect.fail, and in an
// async function, where it rejects the Promise (decided detail 251):
//
//	function check(id: string) {
//	  if (!id) throw new Error("no id")      // EK0401
//	}
//	effect function load(id: string) {
//	  if (!id) throw new NotFound({ id })    // Effect.fail
//	}
//
// Every throw counts, caught by its own try statement or not. A call known to
// throw, such as JSON.parse(text), is EK0401 too, unless it stands in the try
// block of a try statement with a catch clause in the same function, or in
// a function literal whose throws belong to the call it is passed to
// (throwsBelongToCall). A throw expression and a do block are the throw
// statement they hold: the arrow the
// parser writes for them (parser/vibelang_blocks.go) belongs to the code
// around it. Code that must throw a JavaScript exception moves to a .ts file
// or a module block, whose body is TypeScript (modules.go).

var (
	// throwOutsideEffect is EK0401's text for a throw in synchronous code.
	throwOutsideEffect = EK0401.With("A 'throw' is not allowed outside effect code: synchronous VibeLang code never throws. Make the function 'effect' (its 'throw' becomes 'Effect.fail'), or move the code to a '.ts' file.")
	// throwAtTopLevel is EK0401's text for a throw at a module's top level.
	throwAtTopLevel = EK0401.With("A 'throw' is not allowed at the top level of a VibeLang module. Move the code to a '.ts' file, or run it in an 'effect' function.")
	// throwingCallOutsideEffect is EK0401's text for a call known to throw in
	// synchronous code. {0} is the callee, {1} what it throws.
	throwingCallOutsideEffect = EK0401.With("'{0}' may throw '{1}', and synchronous VibeLang code never throws. Make the function 'effect' and run the call with 'try Effect.try(() => …)', or move the code to a '.ts' file.")
)

func init() {
	fileChecks = append(fileChecks, checkThrowsOutsideEffect)
}

// checkThrowsOutsideEffect reports EK0401 at each throw statement of file
// that runs in synchronous code outside effect code.
func checkThrowsOutsideEffect(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsVibeLangModuleDeclaration(node) {
			return false // a module block's body is TypeScript
		}
		if node.Kind == ast.KindThrowStatement {
			if home := a.plainHomeOf(node); home != nil {
				if home.Kind == ast.KindSourceFile {
					report(c, node, throwAtTopLevel)
				} else {
					report(c, node, throwOutsideEffect)
				}
			}
		}
		if failures := a.knownThrows(node); failures != nil {
			if home := a.plainHomeOf(node); home != nil && !a.throwsBelongToCall(home) {
				report(c, node, throwingCallOutsideEffect, nodeText(file, ast.GetInvokedExpression(node)), typeListText(c, failures))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// knownThrows returns what node, a call or new expression, is known to throw
// when nothing catches it: the failures its callee's contract lists, a
// written @throws on a .ts or .d.ts declaration or a built-in's shipped
// annotation, such as JSON.parse's SyntaxError. A call in the try block of a
// try statement with a catch clause in the same function can't throw out of
// it (DESIGN.md, 2026-10-31 correction), so it has none, and so does a call
// with no contract: its throwing is unknown, and it stays an ordinary call.
// A written @throws {unknown} is a contract: the call may throw unknown.
// VibeLang callables carry no thrown types (trustES).
func (a *analyzer) knownThrows(node *ast.Node) []*checker.Type {
	if !ast.IsCallExpression(node) && !ast.IsNewExpression(node) || inCatchingTry(node) {
		return nil
	}
	if ast.IsCallExpression(node) && (ast.IsSuperCall(node) || ast.IsImportCall(node)) {
		return nil
	}
	t := callTrust(a.checker, node)
	if t.promise || a.performs(node) {
		return nil
	}
	if t.unknown {
		// a written @throws {unknown} says the call may throw anything, an
		// affirmative contract; no tag at all stays an ordinary call (detail 255)
		return []*checker.Type{a.checker.GetUnknownType()}
	}
	if len(t.failures) == 0 {
		return nil
	}
	types := make([]*checker.Type, 0, len(t.failures))
	for _, f := range t.failures {
		types = append(types, f.t)
	}
	return types
}

// throwsBelongToCall reports whether home, the plain code a call known to
// throw sits in, is inside a function literal passed where throws are
// admitted: the code Effect.try or Effect.tryPromise wraps, a Promise
// executor, or an argument whose parameter type has a @throws call signature.
// Such a literal may contain calls known to throw, in callbacks of its own
// included; a throw statement in it is still EK0401.
func (a *analyzer) throwsBelongToCall(home *ast.Node) bool {
	for n := home; n != nil; n = n.Parent {
		if ast.IsFunctionExpressionOrArrowFunction(n) && (isWrappedCode(n) || admitsThrows(a.checker, n)) {
			return true
		}
	}
	return false
}

// admitsThrows reports whether fn, a function literal, is an argument whose
// parameter admits throws: the executor of the global Promise, or a parameter
// whose function type's call signature carries a @throws other than never.
func admitsThrows(c *checker.Checker, fn *ast.Node) bool {
	node := fn
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	call := node.Parent
	if call == nil || !ast.IsCallExpression(call) && !ast.IsNewExpression(call) {
		return false
	}
	index := slices.Index(call.Arguments(), node)
	if index < 0 {
		return false
	}
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	if decl := signature.Declaration(); ast.IsNewExpression(call) && decl != nil && isLibFile(c, ast.GetSourceFileOfNode(decl)) &&
		ast.IsIdentifier(call.Expression()) && call.Expression().Text() == "Promise" {
		return true
	}
	parameters := signature.Parameters()
	if index >= len(parameters) {
		return false
	}
	for _, target := range c.GetSignaturesOfType(c.GetTypeOfSymbol(parameters[index]), checker.SignatureKindCall) {
		decl := target.Declaration()
		if decl == nil {
			continue
		}
		for _, host := range jsdocHosts(decl) {
			if !hasThrowsTag(host) {
				continue
			}
			failures, _, unknown := throwsOf(c, host)
			if unknown || len(failures) != 0 {
				return true
			}
		}
	}
	return false
}

// plainHomeOf returns the synchronous code outside effect code that node
// runs in, or nil when node runs in effect code, in an async function, or in
// a module block. The code is a function, a class field or static block, or
// the source file for a module's top level. A parameter list runs before the
// function's Effect exists, so it is plain code even in an effect function;
// an ordinary async function's parameter list rejects its Promise instead,
// and an async generator's runs at the call.
func (a *analyzer) plainHomeOf(node *ast.Node) *ast.Node {
	inParameters := false
	for n := node.Parent; n != nil; n = n.Parent {
		switch {
		case parser.IsVibeLangModuleDeclaration(n):
			return nil
		case n.Kind == ast.KindParameter:
			inParameters = true
		case n.Kind == ast.KindSourceFile, n.Kind == ast.KindPropertyDeclaration, n.Kind == ast.KindClassStaticBlockDeclaration:
			return n
		case ast.IsFunctionLike(n):
			if isProgramArrow(n) && !isMarkedEffect(n) {
				continue // a throw or do expression, a match arm, or a catch expression's side
			}
			flags := ast.GetFunctionFlags(n)
			async := flags&ast.FunctionFlagsAsync != 0
			if inParameters {
				if async && flags&ast.FunctionFlagsGenerator == 0 {
					return nil
				}
				return n
			}
			if async || a.runsAsEffect(n) {
				return nil
			}
			return n
		}
	}
	return nil
}

// runsAsEffect reports whether fn's body is effect code: fn is marked effect,
// or the analyzer compiles it to an Effect. A plain catch handler is plain
// whatever its body holds: its syntax decides its kind (VIP-5).
func (a *analyzer) runsAsEffect(fn *ast.Node) bool {
	if isMarkedEffect(fn) {
		return true
	}
	if isCatchHandlerOf(fn) || !isLowerable(fn) {
		return false
	}
	return a.isEffect(fn)
}

// failsBeyondThrows reports whether something other than a throw statement
// adds an expected failure that can escape body: a call that runs an Effect,
// or a call whose exceptions are typed failures. EK0401 reports each throw
// statement itself, so a plain-code check that would report the same failure
// again asks this first.
func (a *analyzer) failsBeyondThrows(body *ast.Node) bool {
	if body == nil {
		return false
	}
	info := a.flowOf(body)
	for i, t := range info.errors {
		if t == nil || t.Flags()&checker.TypeFlagsNever != 0 {
			continue
		}
		source := info.errorSources[i]
		if source != nil && source.Parent != nil && source.Parent.Kind == ast.KindThrowStatement {
			continue
		}
		if arrow := invokedArrow(source); arrow != nil && !a.failsBeyondThrows(arrow.Body()) {
			continue
		}
		return true
	}
	return false
}

// isThrowForm reports whether call is a throw expression or a do block, which
// the parser writes as (() => { … })(), that runs no Effect and fails only by
// its throw statements. EK0401 reports each of those throws, so a check that
// would report the form as a program run, such as EK1001 in a field
// initializer or EK9203 at a plain return annotation, asks this first.
func (a *analyzer) isThrowForm(call *ast.Node) bool {
	arrow := invokedArrow(call)
	if arrow == nil {
		return false
	}
	file := ast.GetSourceFileOfNode(call)
	text := nodeText(file, call)
	if !isInvokedForm(file, call) || !strings.HasPrefix(text, "throw") && !strings.HasPrefix(text, "do") {
		return false
	}
	return !a.failsBeyondThrows(arrow.Body()) && a.firstRunBeyondThrows(arrow) == nil
}

// firstRunBeyondThrows returns the first call in fn's body that runs an
// Effect, looking inside throw expressions and do blocks, or nil when the
// only programs fn's body runs are throw forms (isThrowForm).
func (a *analyzer) firstRunBeyondThrows(fn *ast.Node) *ast.Node {
	var first *ast.Node
	a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
		if !a.performs(call) {
			return false
		}
		if arrow := invokedArrow(call); arrow != nil {
			if inner := a.firstRunBeyondThrows(arrow); inner != nil {
				first = inner
				return true
			}
			if a.isThrowForm(call) {
				return false
			}
		}
		first = call
		return true
	})
	return first
}

// typeListText returns the union of types as TypeScript writes it, or "never"
// for none.
func typeListText(c *checker.Checker, types []*checker.Type) string {
	if len(types) == 0 {
		return "never"
	}
	return c.TypeToString(c.GetUnionType(types))
}
