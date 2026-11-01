package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// lowering rewrites one .vibe file so it runs on Effect 4. It runs before the
// TypeScript transforms, which then erase types and convert modules as usual.
// A function that the plan marks as an Effect becomes an Effect.fnUntraced
// generator, and each call in it that the plan marks as running becomes a
// yield*:
//
//	export function greet(name: string) {
//	  Console.log(`hello, ${name}`)
//	  return name.length
//	}
//
// becomes
//
//	import * as Effect from "effect/Effect"
//	export function greet(arg) {
//	  return Effect.fnUntraced(function* greet(name: string) {
//	    yield* Console.log(`hello, ${name}`)
//	    return name.length
//	  }).apply(this, arguments)
//	}
type lowering struct {
	jsx core.JsxEmit // native .tsx output names follow the project JSX mode
	transformers.Transformer
	plan         *plan
	effect       *ast.IdentifierNode // local name for effect's Effect module, imported on first use
	runtime      *ast.IdentifierNode // local name for vibelang-runtime, imported on first use
	inEffect     bool                // visiting code that runs inside a lowered generator
	frame        *frame              // the generator being emitted while inEffect
	eagerWeight  int                 // charge for the native frame whose cycle calls are being emitted
	eagerCaches  []*ast.Node         // private, lazy cross-module native entries
	eagerEscapes bool                // the native body must restore published state on exit
	eagerBudget  *ast.Node           // remaining budget passed between native cycle members
	rawPlain     bool                // the original JS body used across synchronous callback boundaries
	rawCallbacks bool                // nested callbacks of a plain cycle retain their original JS recursion
	plain        bool                // visiting the body of a .vibe function that compiles to plain JavaScript
	imports      []namedImport       // named imports the lowering adds, such as a @throws class
	commonJS     bool                // the file is emitted as CommonJS, which has no import.meta (entry.go) and reads imported plain variants from the module (plain_lower.go)

	// scopes maps each Scope region's block to the name of its Scope (scopes_lower.go).
	scopes map[*ast.Node]*ast.Node
	// loopRegion is the loop body visitScopeLoopBody is lowering inside its
	// region, so that visiting it there lowers the statement itself.
	loopRegion *ast.Node

	// modules maps an effect module, such as effect/Stream, to the local name
	// of its namespace import, for method calls (datamethods.go).
	modules     map[string]*ast.IdentifierNode
	moduleOrder []string

	// topicNames maps a pipe that keeps its left side's value in a variable
	// to that variable's name where the lowering is; rebinding marks the
	// function being lowered inside an arrow function that rebinds them
	// (pipes_lower.go).
	topicNames map[*ast.Node]*ast.IdentifierNode
	rebinding  map[*ast.Node]bool

	// frames records the super and arguments references of the file's
	// functions, which a generator the lowering introduces cannot bind
	// (frames_lower.go).
	frames frameReferences

	// fresh names the bindings the lowering introduces (hygiene.go).
	fresh freshNames

	// chainGuards holds the ?. links of optional chains that a test before
	// the chain covers (chains_lower.go).
	chainGuards map[*ast.Node]*chainGuard
}

func newLowering(opts *transformers.TransformOptions, file *ast.SourceFile) *transformers.Transformer {
	if !isVibeLangFile(file) {
		return nil
	}
	tx := &lowering{
		plan:     planFile(opts.EmitResolver, file),
		jsx:      opts.CompilerOptions.Jsx,
		frames:   findFrameReferences(file),
		fresh:    freshNames{file: file},
		commonJS: opts.GetEmitModuleFormatOfFile != nil && opts.GetEmitModuleFormatOfFile(file) == core.ModuleKindCommonJS,
	}
	return tx.NewTransformer(tx.visit, opts.Context)
}

func (tx *lowering) visit(node *ast.Node) *ast.Node {
	if module := tx.plan.collisionModules[node]; module != "" && ast.IsPropertyAccessExpression(node) {
		return tx.moduleNamespace(module)
	}
	if tx.frames.binders[node] {
		return tx.hoistFrameReferences(node, tx.visitSource(node)) // super and arguments (frames_lower.go)
	}
	if tx.plan.classAliases[node] {
		return tx.classAlias(node, tx.visitSource(node)) // a shadowed failure class (trust_lower.go)
	}
	return tx.visitSource(node)
}

// visitSource lowers node, a node of the .vibe file or one the lowering made.
func (tx *lowering) visitSource(node *ast.Node) *ast.Node {
	if pipes := tx.plan.topicClosures[node]; len(pipes) != 0 && !tx.rebinding[node] {
		return tx.visitTopicClosure(node, pipes)
	}
	visited := tx.visitNode(node)
	if tx.inEffect && tx.plan.returns[node] {
		result := tx.Factory().NewYieldExpression(tx.Factory().NewToken(ast.KindAsteriskToken), visited)
		tx.EmitContext().SetOriginal(result, node)
		result.Loc = node.Loc
		return result
	}
	return visited
}

func (tx *lowering) visitNode(node *ast.Node) *ast.Node {
	if link := tx.guardedLink(node); link != nil {
		return tx.visitGuardedChain(node, link) // a ?. before a yield (chains_lower.go)
	}
	switch {
	case doBindingMethod(node) != nil:
		bound := tx.generated(tx.runtimeCall("$bindMethod", tx.visit(doBindingMethod(node)), tx.visit(node.Arguments()[0])))
		tx.EmitContext().SetOriginal(bound, node)
		bound.Loc = node.Loc
		return bound
	case tx.plan.fieldlessErrorConstructors[node]:
		f := tx.Factory()
		super := f.NewExpressionStatement(f.NewCallExpression(f.NewKeywordExpression(ast.KindSuperKeyword), nil, nil, f.NewNodeList(nil), ast.NodeFlagsNone))
		statements := []*ast.Node{super}
		// The parser's Pick<Sub, "field" | ...> names exactly the declared
		// input fields. Do not copy extra properties such as _tag from an
		// otherwise assignable fields object.
		keys := node.Parameters()[0].Type().TypeArguments()[1].TypeArguments()[1]
		fields := []*ast.Node{keys}
		if keys.Kind == ast.KindUnionType {
			fields = keys.AsUnionTypeNode().Types.Nodes
		}
		for _, field := range fields {
			name := field.AsLiteralTypeNode().Literal.Text()
			target := f.NewElementAccessExpression(f.NewThisExpression(), nil, f.NewStringLiteral(name, ast.TokenFlagsNone), ast.NodeFlagsNone)
			value := f.NewElementAccessExpression(f.NewIdentifier("args"), nil, f.NewStringLiteral(name, ast.TokenFlagsNone), ast.NodeFlagsNone)
			statements = append(statements, f.NewExpressionStatement(f.NewBinaryExpression(nil, target, nil, f.NewToken(ast.KindEqualsToken), value)))
		}
		result := f.UpdateConstructorDeclaration(node.AsConstructorDeclaration(), node.Modifiers(), nil, node.AsConstructorDeclaration().Parameters, nil, nil, f.NewBlock(f.NewNodeList(statements), true))
		tx.EmitContext().SetOriginal(result, node)
		return result
	case tx.chainGuards[node] != nil:
		return tx.visitGuardedLink(node)
	case tx.plan.unreachable[node]:
		return nil // the $noMatch of a match D209 proves exhaustive (D294, match_lower.go)
	case tx.plan.checked[node] != nil:
		return tx.visitCheckedArm(node, tx.plan.checked[node])
	case node.Kind == ast.KindSourceFile:
		return tx.visitSourceFile(node.AsSourceFile())
	case platformImport(node) != nil:
		// A platform import names the entry's platform and loads nothing (D312,
		// entry.go), so it is elided as an import type is.
		return tx.EmitContext().NewNotEmittedStatement(node)
	case node.Kind == ast.KindImportDeclaration || node.Kind == ast.KindExportDeclaration:
		return tx.visitImportOrExport(node)
	case isPipe(node):
		return tx.visitPipe(node)
	case isTopic(node):
		return tx.visitTopic(node)
	case node.Kind == ast.KindCallExpression && tx.plan.hatches[node] != (hatchForm{}):
		return tx.visitHatchCall(node)
	case node.Kind == ast.KindCallExpression && tx.plan.variantTests[node] != "":
		return tx.visitVariantTest(node, tx.plan.variantTests[node]) // a data variant's pattern (data_lower.go)
	case node.Kind == ast.KindCallExpression && tx.plan.builtinTests[node] != (builtinTest{}):
		return tx.visitBuiltinTest(node, tx.plan.builtinTests[node]) // String, Option.None (match_builtins.go)
	case node.Kind == ast.KindCallExpression && tx.plan.methods[node].module != "":
		return tx.visitModuleMethodCall(node)
	// A loop body that is not a block and owns a fork is the region of one
	// iteration (D408).
	case tx.inEffect && tx.plan.scopeLoops[node] && tx.loopRegion != node:
		return tx.visitScopeLoopBody(node)
	// A provide block may also own using resources or forked fibers. Keep
	// provision outside its Scope region; regionStatements lowers that region.
	case tx.inEffect && isProvideBlock(node):
		return tx.visitProvideBlock(node)
	// An interruption block may also own using resources or forked fibers.
	// Keep its mask outside its Scope region; regionStatements lowers that
	// region inside the masked closure.
	case tx.inEffect && maskWord(node) != "":
		return tx.visitMaskBlock(node, maskWord(node)) // uninterruptible { ... } (primitives.go)
	case tx.inEffect && tx.plan.scoped(node):
		return tx.visitScoped(node)
	case node.Kind == ast.KindCallExpression && tx.inEffect && tx.frame.handleClause != nil && tx.isClauseResume(node):
		return tx.visitClauseResume(node)
	case isInvocation(node) && tx.inEffect && tx.plan.runsCall(node):
		return tx.visitRunningCall(node)
	case isTryCall(node):
		return tx.visitTry(node) // try e passed by name passes e (try.go)
	case isInvocation(node) && tx.inEffect && tx.plan.trusted[node] != nil:
		return tx.visitTrustedCall(node)
	case isInvocation(node) && tx.plain && tx.plan.trusted[node] != nil:
		return tx.visitTrustedPlainCall(node)
	case tx.plan.recording[node] != "":
		return tx.visitAcquisitionReference(node) // Effect's acquireRelease, as the runtime's (D401, scopes_lower.go)
	case node.Kind == ast.KindPropertyAccessExpression && tx.inEffect && tx.plan.looksUp(node):
		return tx.visitServiceLookup(node)
	case node.Kind == ast.KindPropertyAccessExpression && tx.plan.aliases[node] != "":
		return tx.visitModuleAlias(node)
	case node.Kind == ast.KindClassDeclaration && tx.plan.hasKey(node):
		return tx.visitServiceClass(node)
	case tx.inEffect && isHandleStatement(node):
		return tx.visitHandleStatement(node) // try { ... } handle Control.op(...) { ... } (handles.go)
	case tx.inEffect && node.Kind == ast.KindTryStatement:
		return tx.visitTryStatement(node)
	case maskMarkerWord(node) != "" || exitBindingOf(node) != nil:
		return nil // the marker of an interruption block, or finally (exit)'s binding (primitives.go)
	case isFailureTest(node):
		return tx.visitFailureTest(node)
	case isProvideLayer(node):
		return nil // visitProvideBlock lowers the layer expression itself
	case isClauseBinding(node):
		return nil // clauseFunction binds a handle clause's parameters itself
	case tx.inEffect && tx.frame.handleClause != nil && node.Kind == ast.KindReturnStatement && tx.isClauseResume(node.Expression()):
		return tx.visitClauseResumeReturn(node)
	case tx.inEffect && node.Kind == ast.KindThrowStatement:
		return tx.visitThrowStatement(node)
	case tx.inEffect && tx.frame.clause && node.Kind == ast.KindReturnStatement && tx.plan.tailResumeOf(node.Expression()) != nil:
		return tx.visitTailResumeReturn(node)
	case tx.inEffect && tx.frame.clause && node.Kind == ast.KindCallExpression && tx.plan.resumes[node] != "" && tx.plan.isTailResumeBody(node):
		return tx.tailResumeCall(node)
	case tx.inEffect && node.Kind == ast.KindYieldExpression:
		return tx.visitYield(node)
	case tx.inEffect && node.Kind == ast.KindForOfStatement && tx.plan.streamLoops[node]:
		return tx.visitStreamLoop(node)
	case tx.inEffect && node.Kind == ast.KindLabeledStatement && tx.plan.streamLoops[node.AsLabeledStatement().Statement]:
		return tx.visitStreamLoop(node.AsLabeledStatement().Statement) // $forOf takes the label
	case tx.inEffect && (node.Kind == ast.KindReturnStatement || ast.IsBreakOrContinueStatement(node)):
		return tx.visitJump(node)
	case tx.inEffect && isJumpTarget(node):
		return tx.visitJumpTarget(node)
	case tx.inEffect && tx.frame.region != nil && varList(node) != nil:
		return tx.visitVar(node)
	case node.Kind == ast.KindCallExpression && tx.plan.wireOrders[node] != nil:
		return tx.visitWireCall(node)
	case tx.plan.producers[node]:
		return tx.visitProducer(node)
	case node.Kind == ast.KindFunctionDeclaration && tx.plan.isEffect(node):
		return tx.visitEffectFunctionDeclaration(node)
	case node.Kind == ast.KindMethodDeclaration && tx.plan.isEffect(node):
		return tx.lowerMethod(node)
	case tx.plan.isEffect(node):
		return tx.lowerFunction(node)
	case tx.plan.isProgram(node):
		return tx.lowerProgram(node)
	case isFunctionBoundary(node):
		saved := tx.inEffect
		tx.inEffect = false
		defer func() { tx.inEffect = saved }()
	}
	return tx.Visitor().VisitEachChild(node)
}

func (tx *lowering) visitSourceFile(file *ast.SourceFile) *ast.Node {
	visited := tx.reachIntrinsics(tx.Visitor().VisitEachChild(file.AsNode()))
	tx.markProgramArrows(visited)
	visited = tx.closeLoops(visited) // before joinFrames, which wraps a frame whose loop joins failures
	visited = tx.joinFrames(visited) // inside $iteratorFrame, which calls the frame it wraps
	visited = tx.protectIteratorFrames(visited)
	if tx.plan.entry != nil {
		// Run main when the host starts this module (entry.go).
		statements := tx.Factory().NewNodeList(append(append([]*ast.Node{}, visited.Statements()...), tx.entryStatement()))
		statements.Loc = visited.AsSourceFile().Statements.Loc
		visited = tx.Factory().UpdateSourceFile(visited.AsSourceFile(), statements, visited.AsSourceFile().EndOfFileToken)
	}
	imports := preludeImports(&tx.Factory().NodeFactory, tx.plan.prelude)
	if tx.effect != nil {
		imports = append(imports, tx.namespaceImport(tx.effect, "effect/Effect"))
	}
	if tx.runtime != nil {
		imports = append(imports, tx.namespaceImport(tx.runtime, "vibelang-runtime"))
	}
	for _, module := range tx.moduleOrder {
		imports = append(imports, tx.namespaceImport(tx.modules[module], module))
	}
	imports = append(imports, tx.namedImportDeclarations()...)
	if len(imports) == 0 {
		return visited
	}
	if tx.commonJS {
		for i, declaration := range imports {
			imports[i] = requireNamedImports(&tx.Factory().NodeFactory, declaration)
		}
	}
	if len(tx.eagerCaches) != 0 {
		imports = append(imports, tx.Factory().NewVariableStatement(nil, tx.Factory().NewVariableDeclarationList(tx.Factory().NewNodeList(tx.eagerCaches), ast.NodeFlagsNone)))
	}
	// The list keeps the source range, from whose end the printer emits the
	// comments after the last statement.
	statements := tx.Factory().NewNodeList(append(imports, visited.Statements()...))
	statements.Loc = visited.AsSourceFile().Statements.Loc
	return tx.Factory().UpdateSourceFile(visited.AsSourceFile(), statements, visited.AsSourceFile().EndOfFileToken)
}

// namespaceImport returns `import * as name from "module"`.
func (tx *lowering) namespaceImport(name *ast.IdentifierNode, module string) *ast.Node {
	f := tx.Factory()
	declaration := f.NewImportDeclaration(
		nil, /*modifiers*/
		f.NewImportClause(ast.KindUnknown, nil /*name*/, f.NewNamespaceImport(name)),
		f.NewStringLiteral(module, ast.TokenFlagsNone),
		nil, /*attributes*/
	)
	ast.SetParentInChildren(declaration)
	return declaration
}

// fileName returns a new name for a binding the lowering adds to the file's
// top level: base when neither the file nor another generated name uses it,
// else base_1, base_2, ... A FileLevel name would be checked against the
// file's identifiers only, so it could take the name a module declaration's
// hoisted import (modules.go) generated, and the file would declare it twice.
func (tx *lowering) fileName(base string) *ast.IdentifierNode {
	return tx.Factory().NewUniqueNameEx(base, printer.AutoGenerateOptions{Flags: printer.GeneratedIdentifierFlagsOptimistic})
}

// effectName returns the local name bound to effect's Effect module.
func (tx *lowering) effectName() *ast.IdentifierNode {
	if tx.effect == nil {
		// "Effect" when the file does not use that name, else "Effect_1", ...
		tx.effect = tx.fileName("Effect")
	}
	return tx.effect
}

// visitThrowStatement turns `throw e` into `return yield* Effect.fail(e)`
// (D46): the thrown value is an expected failure, and the return keeps
// TypeScript's narrowing after the throw in the generated code.
func (tx *lowering) visitThrowStatement(node *ast.Node) *ast.Node {
	f := tx.Factory()
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("fail"), ast.NodeFlagsNone)
	fail := f.NewCallExpression(
		callee,
		nil, /*questionDotToken*/
		nil, /*typeArguments*/
		f.NewNodeList([]*ast.Node{tx.Visitor().VisitNode(node.Expression())}),
		ast.NodeFlagsNone,
	)
	statement := f.NewReturnStatement(f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), fail))
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// runtimeMember returns `runtime.name`, where runtime is the local name
// bound to vibelang-runtime.
func (tx *lowering) runtimeMember(name string) *ast.Node {
	if tx.runtime == nil {
		tx.runtime = tx.fileName("runtime")
	}
	return tx.Factory().NewPropertyAccessExpression(tx.runtime, nil /*questionDotToken*/, tx.Factory().NewIdentifier(name), ast.NodeFlagsNone)
}

// succeedByName makes `Effect.succeed(value)` with value's source range: the
// printer emits the comments after a list's last element unless it ends
// where its parent does, which would move the next statement's comment into
// the call.
func (tx *lowering) succeedByName(value *ast.Node) *ast.Node {
	f := tx.Factory()
	succeed := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("succeed"), ast.NodeFlagsNone), nil, nil, f.NewNodeList([]*ast.Node{value}), ast.NodeFlagsNone)
	succeed.Loc = value.Loc
	return succeed
}

// runtimeCall makes `runtime.name(arguments...)`.
func (tx *lowering) runtimeCall(name string, arguments ...*ast.Node) *ast.Node {
	return tx.Factory().NewCallExpression(tx.runtimeMember(name), nil /*questionDotToken*/, nil /*typeArguments*/, tx.Factory().NewNodeList(arguments), ast.NodeFlagsNone)
}

// visitRunningCall turns `f(x)` into `yield* f(x)`.
func (tx *lowering) visitRunningCall(node *ast.Node) *ast.Node {
	var call *ast.Node
	if fiberHelper(node) == "$forConcurrent" && len(node.Arguments()) == 3 {
		call = tx.concurrentForCall(node) // its limit runs before its items (order.go)
	} else if operand := tryOperand(node); operand != nil {
		call = tx.Visitor().VisitNode(operand) // try e runs e: yield* e (try.go)
	} else {
		call = tx.Visitor().VisitEachChild(node)
	}
	if tx.unguardedOptional(node) {
		// Keep the native chain intact: it preserves the receiver and skips
		// arguments when absent. Run its present Effect exactly once, and lift
		// the absent branch to a successful undefined for yield*. A chain
		// that continues after the call is tested before it (chains_lower.go).
		f := tx.Factory()
		absent := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil, f.NewIdentifier("succeed"), ast.NodeFlagsNone), nil, nil, f.NewNodeList([]*ast.Node{f.NewVoidExpression(f.NewNumericLiteral("0", ast.TokenFlagsNone))}), ast.NodeFlagsNone)
		call = f.NewBinaryExpression(nil, call, nil, f.NewToken(ast.KindQuestionQuestionToken), absent)
	}
	run := tx.Factory().NewYieldExpression(tx.Factory().NewToken(ast.KindAsteriskToken), call)
	tx.EmitContext().SetOriginal(run, node)
	return run
}

// lowerFunction turns a function expression or arrow function into
// `Effect.fnUntraced(function* (params) { body })`, or into the same kind of
// function returning its direct Effect (direct.go).
func (tx *lowering) lowerFunction(node *ast.Node) *ast.Node {
	parameters, body := tx.loweredBody(node)
	if hasSimpleParameters(node) && !tx.plan.parameterWrites[node] {
		role := thunkIsReturn // a function expression returns the Effect (directFunction)
		switch {
		case isProgramArrow(node):
			role = programArrowRole(node)
		case node.Kind == ast.KindArrowFunction:
			role = thunkIsNothing
		}
		if effect := tx.directEffect(node, body, role); effect != nil {
			return tx.directFunction(node, parameters, effect)
		}
	}
	if refersToOwnName(node) {
		return tx.selfBoundFunction(node, parameters, body)
	}
	generator := tx.generatorFrom(node, parameters, body)
	if node.Kind != ast.KindArrowFunction {
		tx.forwarding(generator) // Effect.fnUntraced calls it with the function's this and arguments
	}
	lowered := tx.wrapGenerator("fnUntraced", node, generator)
	if keepsThis(node) {
		lowered = tx.Factory().NewFunctionBindCall(lowered, tx.Factory().NewThisExpression(), nil /*argumentsList*/)
	}
	return lowered
}

// lowerProgram turns a lambda with no parameters that is a program into
// `Effect.gen(function* () { body })`, an Effect that runs the body each time
// it runs, or `Effect.gen({ self: this }, function* () { body })` when the
// lambda keeps its enclosing function's this.
func (tx *lowering) lowerProgram(node *ast.Node) *ast.Node {
	parameters, body := tx.loweredBody(node)
	// Only a parameterless arrow: a program lambda can have optional or rest
	// parameters, which must still bind inside the generator on each run.
	// Effect.gen gives a function expression's body no this or arguments,
	// which a thunk in its place would take from its scope.
	if node.Kind == ast.KindArrowFunction && len(node.Parameters()) == 0 {
		// The thunk replaces the lambda, so it stands for the lambda, unless
		// the parser wrote it (isProgramArrow).
		role := thunkIsNode
		if isProgramArrow(node) {
			role = programArrowRole(node)
		}
		if effect := tx.directEffect(node, body, role); effect != nil {
			effect.Loc = node.Loc
			return effect
		}
	}
	generator := tx.generatorFrom(node, parameters, body)
	if !keepsThis(node) {
		return tx.wrapGenerator("gen", node, generator)
	}
	f := tx.Factory()
	self := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("self"), nil /*postfixToken*/, nil /*typeNode*/, f.NewThisExpression()),
	}), false /*multiLine*/)
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("gen"), ast.NodeFlagsNone)
	lowered := f.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{self, generator}), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}

// keepsThis reports whether node is an arrow function that refers to this,
// in its parameters or its body. An arrow function sees its enclosing
// function's this, but the generator function that replaces it has its own,
// so the lowering passes the arrow's this on.
func keepsThis(node *ast.Node) bool {
	return node.Kind == ast.KindArrowFunction && usesThis(node)
}

// generatorOf returns `function* (params) { body }` for node, with node's
// calls that run lowered to yield*.
func (tx *lowering) generatorOf(node *ast.Node) *ast.Node {
	parameters, body := tx.loweredBody(node)
	return tx.generatorFrom(node, parameters, body)
}

// generatorFrom returns `function* (params) { body }` for node, given its
// lowered parameters and body.
func (tx *lowering) generatorFrom(node *ast.Node, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	generator := tx.generatorExpression(node, sourceName(node), parameters, body)
	tx.EmitContext().SetOriginal(generator, node)
	return generator
}

// loweredBody returns node's parameters and its body as a block, with the
// body's calls that run lowered to yield*.
func (tx *lowering) loweredBody(node *ast.Node) (*ast.NodeList, *ast.Node) {
	ec := tx.EmitContext()

	saved, savedFrame, savedPlain := tx.inEffect, tx.frame, tx.plain
	tx.inEffect, tx.plain = false, false // a generator's parameter list cannot yield
	parameters := ec.VisitParameters(node.ParameterList(), tx.Visitor())
	tx.inEffect = true
	tx.frame = &frame{name: sourceName(node), clause: tx.plan.resumesInTail(node)}
	var scope *ast.Node
	if tx.plan.scopeBodies[node.Body()] {
		scope = tx.scopeName(node.Body()) // an expression body that owns forks (D353), named before its forks are visited
	}
	body := ec.VisitFunctionBody(node.Body(), tx.Visitor())
	if !ast.IsBlock(body) {
		body = ec.ConvertToFunctionBlock(body, false /*multiLine*/)
		// The printer emits the comments before the closing brace from the end
		// of the statement list, which would be the expression's source end:
		// the comment after the arrow would also appear inside the block.
		body.AsBlock().Statements.Loc = core.UndefinedTextRange()
	}
	if scope != nil {
		body = tx.scopeBody(node.Body(), scope, body)
	}
	tx.inEffect, tx.frame, tx.plain = saved, savedFrame, savedPlain
	return parameters, body
}

// directFunction returns node, an arrow function or function expression,
// with parameters and a body that returns effect.
func (tx *lowering) directFunction(node *ast.Node, parameters *ast.NodeList, effect *ast.Node) *ast.Node {
	f := tx.Factory()
	var lowered *ast.Node
	if node.Kind == ast.KindArrowFunction {
		lowered = f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, parameters, nil /*typeNode*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), effect)
	} else {
		body := f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(effect))}), false /*multiLine*/)
		lowered = f.NewFunctionExpression(nil /*modifiers*/, nil /*asteriskToken*/, node.Name(), nil /*typeParameters*/, parameters, nil /*typeNode*/, nil /*fullSignature*/, body)
	}
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}

// wrapGenerator returns `Effect.<method>(generator)` in place of node.
func (tx *lowering) wrapGenerator(method string, node *ast.Node, generator *ast.Node) *ast.Node {
	f := tx.Factory()
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier(method), ast.NodeFlagsNone)
	lowered := f.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{generator}), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	return lowered
}

// functionName returns the name of fn, a function the lowering turns into an
// Effect: its own name, or the name of the variable it initializes, or "".
func functionName(fn *ast.Node) string {
	if name := fn.Name(); name != nil && ast.IsIdentifier(name) {
		return name.Text()
	}
	if parent := fn.Parent; parent != nil && parent.Kind == ast.KindVariableDeclaration && ast.IsIdentifier(parent.Name()) {
		return parent.Name().Text()
	}
	return ""
}

// visitEffectFunctionDeclaration keeps a hoisted JavaScript declaration in
// every lexical block (including declarations after a return). Only its body
// becomes an Effect factory; moving a const cannot cover switch clauses or
// cyclic module imports. Keep the existing generator wrapper so
// defaults, destructuring, this, arguments, and recursive references still run
// inside the Effect, rather than eagerly in the forwarding declaration. A
// body with a direct Effect (direct.go) is the declaration's own body.
func (tx *lowering) visitEffectFunctionDeclaration(node *ast.Node) *ast.Node {
	f := tx.Factory()
	loweredParameters, loweredBody := tx.loweredBody(node)
	if hasSimpleParameters(node) && !tx.plan.parameterWrites[node] {
		if effect := tx.directEffect(node, loweredBody, thunkIsReturn); effect != nil {
			body := f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(effect))}), true /*multiLine*/)
			return tx.effectFunctionDeclaration(node, loweredParameters, body)
		}
	}
	// The declaration stands for the source function; the generator it
	// forwards to maps to no source position (generated.go) and runs as the
	// source function on every run (frames_lower.go).
	lowered := tx.wrapGenerator("fnUntraced", node, tx.generatedFunctions(tx.forwarding(tx.generatorFrom(node, loweredParameters, loweredBody))))

	// Forward all arguments without evaluating the source parameters twice.
	// Placeholder parameters preserve fnUntraced's observable function length.
	var parameters []*ast.Node
	for _, parameter := range node.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		p := parameter.AsParameterDeclaration()
		if p.Initializer != nil || p.DotDotDotToken != nil {
			break
		}
		parameters = append(parameters, f.NewParameterDeclaration(nil, nil, f.NewUniqueName("arg"), nil, nil, nil))
	}
	apply := f.NewPropertyAccessExpression(lowered, nil, f.NewIdentifier("apply"), ast.NodeFlagsNone)
	call := f.NewCallExpression(apply, nil, nil, f.NewNodeList([]*ast.Node{f.NewThisExpression(), f.NewIdentifier("arguments")}), ast.NodeFlagsNone)
	// A source directive such as "use strict" also governs the forwarding
	// declaration's receiver coercion when the file emits as a script.
	var statements []*ast.Node
	for _, statement := range bodyStatements(node.Body()) {
		if !ast.IsPrologueDirective(statement) {
			break
		}
		statements = append(statements, f.NewExpressionStatement(f.NewStringLiteralFromNode(statement.Expression())))
	}
	statements = append(statements, tx.generated(f.NewReturnStatement(call)))
	body := f.NewBlock(f.NewNodeList(statements), true /*multiLine*/)
	return tx.effectFunctionDeclaration(node, f.NewNodeList(parameters), body)
}

// effectFunctionDeclaration returns the declaration that replaces node, an
// Effect function declaration, with parameters and body.
func (tx *lowering) effectFunctionDeclaration(node *ast.Node, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	f := tx.Factory()
	// async is implemented by the Effect generator, not by this wrapper.
	var modifiers []*ast.Node
	if ast.HasSyntacticModifier(node, ast.ModifierFlagsExport) {
		modifiers = append(modifiers, f.NewModifier(ast.KindExportKeyword))
	}
	if ast.HasSyntacticModifier(node, ast.ModifierFlagsDefault) {
		modifiers = append(modifiers, f.NewModifier(ast.KindDefaultKeyword))
	}
	name := node.Name()
	if name == nil {
		name = f.NewIdentifier(functionName(node)) // an arrow a const holds (constArrowOf)
	}
	statement := f.NewFunctionDeclaration(f.NewModifierList(modifiers), nil, name, nil, parameters, nil, nil, body)
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// bodyStatements returns bodys statements, or none for an arrows
// expression body.
func bodyStatements(body *ast.Node) []*ast.Node {
	if body == nil || !ast.IsBlock(body) {
		return nil
	}
	return body.Statements()
}
