package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// Where programs start (design D38, Chapter 13). A call never starts a fiber;
// a program starts only when a runner receives it. A module's top level is not
// inside any program, so a call there may build values but not run a program
// (EK1001):
//
//	export const config = loadConfig()          // EK1001
//	NodeRuntime.runMain(() => main())           // a runner: allowed here
//
// A runner may be called only where no fiber runs the code: at a module's top
// level, in an async function, and in a plain callback that such a place
// passes to a TypeScript function, such as a describe body or a framework's
// route handler. Anywhere else it would start a new root with an empty
// Context, outside the caller's structured concurrency (EK1005):
//
//	function refreshAll(ids: ReadonlyArray<string>) {
//	  for (const id of ids) Effect.runFork(() => refresh(id))   // EK1005
//	}
//
// The compiler knows runners by the declarations their calls resolve to.

// effectRootRunners are the runners that effect's Effect module exports and
// that start their program with an empty Context.
var effectRootRunners = []string{"runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"}

// effectContextRunners are their *With forms, which take a Context.
var effectContextRunners = []string{"runPromiseWith", "runPromiseExitWith", "runSyncWith", "runSyncExitWith", "runForkWith", "runCallbackWith"}

// managedRuntimeRunners are the run methods of effect's ManagedRuntime.
var managedRuntimeRunners = []string{"runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"}

// runnerKind tells a test registration from a runner that starts a program.
type runnerKind uint8

const (
	notRunner runnerKind = iota
	programRunner
	testRunner
)

// runnerOf reports whether call calls a runner, and which kind: Effect's
// run functions and their *With forms, ManagedRuntime's run methods,
// NodeRuntime.runMain, BunRuntime.runMain and BrowserRuntime.runMain, and
// @effect/vitest's it.effect
// and it.live with their modifiers, .each, and .prop forms, and layer(…).
func runnerOf(c *checker.Checker, call *ast.Node) runnerKind {
	d, ok := calleeIdentity(c, call)
	switch {
	case !ok:
		return notRunner
	case d.pkg == "effect" && d.module == "Effect" && d.owner.Kind == ast.KindVariableDeclaration && slices.Contains(effectContextRunners, d.name):
		// Effect.runPromiseWith(context) returns a runner and starts nothing;
		// applying that runner to a program, whose signature is the one the
		// declared type returns, starts one.
		if signatureDeclaration(c, call).Parent == d.owner {
			return notRunner
		}
		return programRunner
	case d.pkg == "effect" && d.module == "ManagedRuntime" && d.container == "ManagedRuntime" && slices.Contains(managedRuntimeRunners, d.name),
		isRootRunnerIdentity(d):
		return programRunner
	case d.pkg == "@effect/vitest":
		switch {
		case d.owner.Kind == ast.KindInterfaceDeclaration && d.name == "Test",
			d.container == "Tester" && (d.name == "each" || d.name == "prop"),
			d.name == "layer" && (d.container == "" || d.container == "MethodsNonLive" || d.container == "Methods"):
			return testRunner
		}
	}
	return notRunner
}

// isRootRunner reports whether call calls a runner whose program starts with
// an empty Context, so the program must need no service (D27): Effect's run
// functions, but not their *With forms, and NodeRuntime.runMain,
// BunRuntime.runMain and BrowserRuntime.runMain.
func isRootRunner(c *checker.Checker, call *ast.Node) bool {
	d, ok := calleeIdentity(c, call)
	return ok && isRootRunnerIdentity(d)
}

func isRootRunnerIdentity(d identity) bool {
	switch {
	case d.pkg == "effect" && d.module == "Effect":
		return d.owner.Kind == ast.KindVariableDeclaration && slices.Contains(effectRootRunners, d.name)
	case d.pkg == "@effect/platform-node" && d.module == "NodeRuntime", d.pkg == "@effect/platform-bun" && d.module == "BunRuntime",
		d.pkg == "@effect/platform-browser" && d.module == "BrowserRuntime":
		return d.name == "runMain"
	}
	return false
}

// isTestRegistration reports whether call registers a test with
// @effect/vitest's it.effect or it.live, or a modifier of them, whose
// program a test fiber runs.
func isTestRegistration(c *checker.Checker, call *ast.Node) bool {
	d, ok := calleeIdentity(c, call)
	return ok && d.pkg == "@effect/vitest" && d.owner.Kind == ast.KindInterfaceDeclaration && d.name == "Test"
}

// identity names the declaration that a call resolves to.
type identity struct {
	pkg       string    // the package that declares it, such as "effect"
	module    string    // its module in the package, such as "Effect"
	container string    // the interface, class, or namespace that declares it, or ""
	name      string    // its name
	owner     *ast.Node // the declaration
}

// calleeIdentity returns the identity of the declaration whose signature
// call resolves to.
func calleeIdentity(c *checker.Checker, call *ast.Node) (identity, bool) {
	owner := ownerOf(signatureDeclaration(c, call))
	if owner == nil {
		return identity{}, false
	}
	file := ast.GetSourceFileOfNode(owner)
	return identity{pkg: packageOf(c, file), module: moduleOf(file), container: containerName(owner), name: declarationName(owner), owner: owner}, true
}

func init() {
	fileChecks = append(fileChecks, checkProgramStarts)
}

// checkProgramStarts reports EK1001 for each call at file's top level that runs a
// program, and for each in code that runs as plain JavaScript wherever it
// stands (D282): a class field's initializer, a default parameter value, a
// constructor, an accessor or a static block. It reports EK1005 for each
// runner that code a fiber runs calls.
func checkProgramStarts(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node, topLevel bool, plain *ast.Node) bool
	visit = func(node *ast.Node, topLevel bool, plain *ast.Node) bool {
		switch {
		case node.Kind == ast.KindConstructor || node.Kind == ast.KindGetAccessor || node.Kind == ast.KindSetAccessor || node.Kind == ast.KindClassStaticBlockDeclaration:
			topLevel, plain = false, node
		case ast.IsFunctionLike(node) && node.Body() != nil:
			topLevel, plain = false, nil
		case node.Kind == ast.KindParameter && node.Initializer() != nil:
			plain = node
		case ast.IsPropertyDeclaration(node) && node.Parent != nil && ast.IsClassLike(node.Parent) && node.Initializer() != nil:
			// One declared with an Effect type holds the program its
			// initializer builds, as a const does (D269).
			if node.Type() == nil || !isEffectType(c, c.GetTypeFromTypeNode(node.Type())) {
				plain = node
			}
		}
		if ast.IsTaggedTemplateExpression(node) && topLevel && !a.passedAsProgram(node) && a.runs(node) {
			report(c, node, EK1001, nodeText(file, node))
			return false
		}
		if ast.IsCallExpression(node) {
			if plain != nil && !a.passedAsProgram(node) {
				if runs, explains := runsAtTopLevel(c, a, node); runs {
					reportPlainCodeRun(c, file, node, plain)
					if explains {
						cover(c, node)
					}
					return false
				}
			}
			if topLevel && plain == nil && !a.passedAsProgram(node) {
				if runs, explains := runsAtTopLevel(c, a, node); runs {
					reportTopLevelRun(c, file, node)
					if explains {
						cover(c, node)
					}
					return false // one error for the outermost program
				}
			}
			if kind := runnerOf(c, node); kind != notRunner && !isRunnerCallee(c, node) && !outsideFibers(c, a, node) {
				reportNestedRunner(c, file, node, kind)
			}
		}
		return node.ForEachChild(func(child *ast.Node) bool { return visit(child, topLevel, plain) })
	}
	file.AsNode().ForEachChild(func(child *ast.Node) bool { return visit(child, true, nil) })
}

// reportPlainCodeRun reports EK1001 for call, which would run a program in
// plain, code that runs as plain JavaScript outside any program, as a module's
// top level does (D282): a class field's initializer, a default parameter
// value, a constructor, an accessor or a static block.
func reportPlainCodeRun(c *checker.Checker, file *ast.SourceFile, call *ast.Node, plain *ast.Node) {
	text := nodeText(file, call.Expression()) + "()"
	switch plain.Kind {
	case ast.KindPropertyDeclaration:
		d := report(c, call, EK1001.With("{0} runs a program, but a class field's initializer runs as plain JavaScript, outside any program."), text)
		note(d, "Compute the value in an Effect function and pass it to the constructor, or make {0} a method.", nodeText(file, plain.Name()))
	case ast.KindParameter:
		d := report(c, call, EK1001.With("{0} runs a program, but a default parameter value is plain JavaScript, so the call does not run."), text)
		note(d, "Make {0} optional and compute the default in the body: {0} ?? {1}.", nodeText(file, plain.Name()), nodeText(file, call))
		cover(c, plain) // TypeScript's error that the program does not fit the parameter's type
	default:
		d := report(c, call, EK1001.With("{0} runs a program, but {1} runs as plain JavaScript, outside any program."), text, plainCodeName(plain))
		switch plain.Kind {
		case ast.KindGetAccessor, ast.KindSetAccessor:
			note(d, "Write a method instead, which runs as an Effect: {0}() { … }.", nodeText(file, plain.Name()))
		case ast.KindConstructor:
			note(d, "Run it in an Effect function before constructing, and pass the result to the constructor.")
		default:
			note(d, "Run it inside a function that a program runs, such as main.")
		}
	}
}

// runsAtTopLevel reports whether call, at a module's top level, would run a
// program: a call that runs an Effect, a service member call such as
// Users.find(id), or a call of an Effect value such as Users() or Port(). The
// checker types the last two only inside function bodies, so at the top level
// TypeScript reports a member that does not exist or a value that is not
// callable, which EK1001 explains.
func runsAtTopLevel(c *checker.Checker, a *analyzer, call *ast.Node) (runs bool, explainsTypeScript bool) {
	if a.runs(call) || a.runsVariant(call) {
		return true, false
	}
	if call.QuestionDotToken() != nil {
		return false, false
	}
	callee := call.Expression()
	if ast.IsPropertyAccessExpression(callee) && !ast.IsPrivateIdentifier(callee.Name()) {
		if identifier, _ := serviceMember(c, callee, c.GetApparentType(c.GetTypeAtLocation(callee.Expression()))); identifier != nil {
			return true, true
		}
	}
	if len(call.Arguments()) == 0 && call.TypeArguments() == nil {
		t := c.GetApparentType(c.GetTypeAtLocation(callee))
		if len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) == 0 && effectOfValue(c, t) != nil {
			return true, true
		}
	}
	return false, false
}

// passedAsProgram reports whether call, at a module's top level, is an
// argument where a program is expected, as main() is in
// NodeRuntime.runMain(main()), or is evaluated by an expression passed by
// name, such as a pipe's left side whose topic is passed by name: a call
// there runs nothing and builds the program the callee receives (D147,
// D155), so EK1001 does not apply.
func (a *analyzer) passedAsProgram(call *ast.Node) bool {
	if a.byNameOf(call) != nil || holdsProgram(a.checker, call) {
		return true
	}
	return a.atProgramPosition(call) || a.inProgramPipe(call)
}

// atProgramPosition reports whether node, an Effect, is an argument where its
// callee expects a program.
func (a *analyzer) atProgramPosition(node *ast.Node) bool {
	owner, path := ownerCall(node)
	if owner == nil || !isEffectType(a.checker, a.checker.GetTypeAtLocation(node)) {
		return false
	}
	signature := a.checker.GetResolvedSignature(owner)
	if signature == nil {
		return false
	}
	return a.classify(a.expectedAt(owner, signature, path, node)).program
}

// inProgramPipe reports whether node is the left side of a pipe, or the body
// of a pipe that is, whose topic lands where a program is expected (D154). At
// a module's top level the left side keeps its Effect type, so its topic
// converts nothing, and the pipe passes it as a call argument there is
// passed: unrun, as the program the callee receives.
func (a *analyzer) inProgramPipe(node *ast.Node) bool {
	n := node
	for n.Parent != nil && (ast.IsParenthesizedExpression(n.Parent) || isPipe(n.Parent) && n.Parent.AsBinaryExpression().Right == n) {
		n = n.Parent
	}
	pipe := pipeOfLeft(n)
	return pipe != nil && slices.ContainsFunc(topicsOf(pipe), a.atProgramPosition)
}

// holdsProgram recognizes a declared Effect const at any scope (D269),
// or a contextual Effect field (D265). Only its initializer is held;
// operands retain D147's ordinary parameter positions.
func holdsProgram(c *checker.Checker, expr *ast.Node) bool {
	if !isVibeLangFile(ast.GetSourceFileOfNode(expr)) || inHatch(expr) {
		return false
	}
	// D269 holds declared consts at every scope; D262's module case remains included.
	if decl := vibelangmapper.HeldConstDeclaration(expr); decl != nil {
		return isEffectType(c, c.GetTypeFromTypeNode(decl.Type()))
	}
	node := expr
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	decl := node.Parent
	if decl == nil || !ast.IsPropertyAssignment(decl) || decl.Initializer() != node {
		return false
	}
	// An await operation's element is a program by syntax, never a held
	// field (D377): its call runs inside that program.
	if awaitLiteralOperation(node) != nil {
		return false
	}
	return holdsField(c, node, decl)
}

// holdsField recognizes D265's contextual Effect field: node, the
// initializer of decl, a property assignment, holds its program. The legacy
// recorder also asks it about an await operation's fields, which held their
// calls through VibeLang 0.0.10.
func holdsField(c *checker.Checker, node, decl *ast.Node) bool {
	// D265 fields keep both established context and the active generic candidate (crash fix).
	if isEffectType(c, c.GetContextualTypeForObjectLiteralElement(decl, checker.ContextFlagsSignature)) {
		return true
	}
	a := analyzerFor(c)
	if owner, path := ownerCall(node); owner != nil {
		if signature := a.candidateOf(owner); signature != nil {
			expected := a.expectedAt(owner, signature, path, node)
			return len(expected) == 1 && isEffectType(c, expected[0])
		}
	}
	return false
}

// reportTopLevelRun reports EK1001 for call, which runs a program at the
// module's top level.
func reportTopLevelRun(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	text := nodeText(file, call.Expression()) + "()"
	if catchExpressionOf(call) != nil || isInvokedForm(file, call) {
		text = nodeText(file, call) // x catch y, whose callee is the keyword (catch_expressions.go), or throw x
	}
	if isInvokedForm(file, call) && strings.HasPrefix(text, "throw") {
		// throw x at the top level, which the parser writes as (() => { throw x })()
		a := analyzerFor(c)
		if source := a.firstFailureSource(invokedArrow(call)); source != nil && source.Parent != nil && source.Parent.Kind == ast.KindThrowStatement {
			d := report(c, call, topLevelFailure, c.TypeToString(a.thrownType(source.Parent)))
			note(d, "Throw inside a function that a program runs, such as main.")
			note(d, moduleThrowNote)
			return
		}
	}
	d := report(c, call, EK1001, text)
	if owner, _ := ownerCall(call); owner != nil && ast.IsCallExpression(owner) && runnerOf(c, owner) != notRunner {
		note(d, "Pass a program, a function with no parameters, to {0}:   () => {1}", nodeText(file, owner.Expression()), nodeText(file, call))
		return
	}
	if declaration := ast.WalkUpParenthesizedExpressions(call).Parent; declaration != nil && ast.IsVariableDeclaration(declaration) && declaration.Initializer() == ast.WalkUpParenthesizedExpressions(call) && ast.IsIdentifier(declaration.Name()) {
		note(d, "Hold the program as a function, and call it inside one: const {0} = () => {1}", declaration.Name().Text(), shortText(nodeText(file, call), "…"))
	}
	note(d, "Run it inside a function that a program runs, such as main.")
	note(d, "Or provide the value as a service with a Layer.")
}

// isInvokedForm reports whether call is an expression form that the parser
// writes as an invoked arrow function: throw x is (() => { throw x })() and
// do { … } is (() => { … })() (D186, D187). Its source text starts with its
// keyword, where a written call of an arrow function starts with (.
func isInvokedForm(file *ast.SourceFile, call *ast.Node) bool {
	callee := call.Expression()
	return len(call.Arguments()) == 0 && ast.IsParenthesizedExpression(callee) && ast.IsArrowFunction(callee.Expression()) &&
		!strings.HasPrefix(nodeText(file, call), "(")
}

// isRunnerCallee reports whether call is the callee of a runner call, as
// Effect.runPromiseWith(context) is in Effect.runPromiseWith(context)(program):
// the outer call is the one to report.
func isRunnerCallee(c *checker.Checker, call *ast.Node) bool {
	parent := call.Parent
	return parent != nil && ast.IsCallExpression(parent) && parent.Expression() == call && runnerOf(c, parent) != notRunner
}

// reportNestedRunner reports EK1005 for call, a runner inside code a fiber
// runs.
func reportNestedRunner(c *checker.Checker, file *ast.SourceFile, call *ast.Node, kind runnerKind) {
	runner := nodeText(file, call.Expression())
	d := report(c, call.Expression(), EK1005, runner, runningFunctionName(enclosingFunction(call)))
	if kind == testRunner {
		note(d, "Register tests at the module's top level, or in a describe callback.")
		return
	}
	program := "() => …"
	if arguments := call.Arguments(); len(arguments) > 0 {
		program = nodeText(file, arguments[0])
		if !ast.IsFunctionExpressionOrArrowFunction(ast.SkipParentheses(arguments[0])) {
			program = "() => " + program
		}
	}
	// A root outlives the fiber that started it; a fork would not (D408).
	note(d, "Call the program, or detach it to let it outlive this fiber, as a root would:   detach({0})", program)
}

// runningFunctionName names fn, the function a fiber runs, for EK1005.
func runningFunctionName(fn *ast.Node) string {
	if name := functionName(fn); name != "" {
		return name
	}
	return "the enclosing function"
}
