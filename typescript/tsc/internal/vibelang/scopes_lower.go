package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// scopePlan records the Scope regions of one file (scopes.go).
type scopePlan struct {
	scopeBlocks map[*ast.Node]bool      // blocks that are Scope regions
	scopeBodies map[*ast.Node]bool      // arrow functions' expression bodies that are Scope regions (D353)
	scopeLoops  map[*ast.Node]bool      // loop bodies that are statements other than blocks and are Scope regions (D408)
	usings      map[*ast.Node]bool      // using statements in those blocks
	forks       map[*ast.Node]*ast.Node // fork calls, mapped to the region that owns the fiber (ownerRegion)
	usingLoops  map[*ast.Node]bool      // for (using x of values) statements, and for (using x = v; ...) statements under their labels
	usingScoped map[*ast.Node]bool      // using declarations whose initializer requires Scope, whose value using may bind without disposing it (D401)
	recording   map[*ast.Node]string    // references to Effect's acquireRelease or acquireDisposable, which denote the runtime's (D401)
	renamed     map[string]bool         // local names that an import gives acquireRelease or acquireDisposable, or nil before the file's imports are read
}

func newScopePlan() scopePlan {
	return scopePlan{scopeBlocks: map[*ast.Node]bool{}, scopeBodies: map[*ast.Node]bool{}, scopeLoops: map[*ast.Node]bool{}, usings: map[*ast.Node]bool{}, forks: map[*ast.Node]*ast.Node{}, usingLoops: map[*ast.Node]bool{}, usingScoped: map[*ast.Node]bool{}, recording: map[*ast.Node]string{}}
}

// planScopes records the Scope regions of fn, a function the lowering turns
// into an Effect, and the using statements and fork calls they own.
func (p *scopePlan) planScopes(a *analyzer, fn *ast.Node) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isFunctionBoundary(node):
			return false
		case isBlockUsing(node):
			p.scopeBlocks[node.Parent] = true
			p.usings[node] = true
			p.planUsingDeclarations(a, node.AsVariableStatement().DeclarationList)
		case isUsingForOf(node):
			p.usingLoops[node] = true
			p.planUsingDeclarations(a, node.AsForInOrOfStatement().Initializer)
		case isUsingFor(node):
			p.usingLoops[outermostLabel(node)] = true
			p.planUsingDeclarations(a, node.AsForStatement().Initializer)
		case node.Kind == ast.KindCallExpression:
			if owner := a.forkOwner(node); owner != nil {
				switch {
				case owner.Kind == ast.KindBlock:
					p.scopeBlocks[owner] = true
				case owner.Parent.Kind == ast.KindArrowFunction:
					p.scopeBodies[owner] = true // loweredBody makes the region
				default:
					p.scopeLoops[owner] = true // for (const x of xs) fork work(x)
				}
				p.forks[node] = owner
			}
		}
		return node.ForEachChild(visit)
	}
	if body := fn.Body(); body != nil {
		visit(body)
	}
}

// planAcquisitionReference records node when it is a reference to Effect's
// Effect.acquireRelease or Effect.acquireDisposable, a call's callee or a
// value, that resolves to Effect's declaration through any import alias
// (rule H4). In VibeLang code such a reference denotes the runtime's form of
// the acquisition, which also records the value whose release it registered,
// so using adds no second release (D401). Hatches and module blocks are
// TypeScript, which calls the runtime's forms itself.
func (p *scopePlan) planAcquisitionReference(c *checker.Checker, node *ast.Node) {
	switch {
	case ast.IsPropertyAccessExpression(node):
		if !ast.IsIdentifier(node.Name()) || !isAcquisitionName(node.Name().Text()) {
			return
		}
	case ast.IsIdentifier(node):
		if !isAcquisitionName(node.Text()) && !p.renamedAcquisitions(ast.GetSourceFileOfNode(node))[node.Text()] {
			return
		}
		if !ast.IsExpressionNode(node) || ast.IsRightSideOfQualifiedNameOrPropertyAccess(node) || ast.IsDeclarationName(node) {
			return
		}
	default:
		return
	}
	if ast.IsPartOfTypeNode(node) || inHatch(node) || inModuleBlock(node) {
		return
	}
	if module, name := effectFunctionOf(c, node); module == "Effect" && (name == "acquireRelease" || name == "acquireDisposable") {
		p.recording[node] = name
	}
}

func isAcquisitionName(name string) bool {
	return name == "acquireRelease" || name == "acquireDisposable"
}

// renamedAcquisitions returns the local names that file's imports give an
// export named acquireRelease or acquireDisposable, which the checker then
// resolves: import { acquireRelease as acquire } from "effect/Effect".
func (p *scopePlan) renamedAcquisitions(file *ast.SourceFile) map[string]bool {
	if p.renamed != nil {
		return p.renamed
	}
	p.renamed = map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) || statement.AsImportDeclaration().ImportClause == nil {
			continue
		}
		bindings := statement.AsImportDeclaration().ImportClause.AsImportClause().NamedBindings
		if bindings == nil || !ast.IsNamedImports(bindings) {
			continue
		}
		for _, specifier := range bindings.AsNamedImports().Elements.Nodes {
			if imported := specifier.AsImportSpecifier().PropertyName; imported != nil && isAcquisitionName(imported.Text()) {
				p.renamed[specifier.Name().Text()] = true
			}
		}
	}
	return p.renamed
}

// visitAcquisitionReference lowers node, a reference to Effect's
// acquireRelease or acquireDisposable, to the runtime's (D401).
func (tx *lowering) visitAcquisitionReference(node *ast.Node) *ast.Node {
	reference := tx.runtimeMember(tx.plan.recording[node])
	tx.EmitContext().SetOriginal(reference, node)
	reference.Loc = node.Loc
	return reference
}

// planUsingDeclarations records, for each declaration of list, a using
// declaration list, whether its initializer requires Scope, which decides
// only whether $using may bind a value it cannot dispose (D401, D490).
func (p *scopePlan) planUsingDeclarations(a *analyzer, list *ast.Node) {
	for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
		if initializer := declaration.Initializer(); initializer != nil && a.requiresScope(ast.SkipParentheses(initializer)) {
			p.usingScoped[declaration] = true
		}
	}
}

// usingCall returns the runtime's $using of initializer, the initializer of
// declaration, with the region's scope: Effect.acquireRelease of the
// initializer with { interruptible: true }, and its one release, for every
// initializer, so the initializer runs with the interruptibility in force
// where the using stands (D490). When the initializer requires Scope, a
// value that $using cannot dispose is bound as it is; otherwise it is a
// TypeError (D401).
func (tx *lowering) usingCall(scope *ast.Node, declaration *ast.Node, initializer *ast.Node) *ast.Node {
	f := tx.Factory()
	requiresScope := f.NewKeywordExpression(ast.KindFalseKeyword)
	if tx.plan.usingScoped[declaration] {
		requiresScope = f.NewKeywordExpression(ast.KindTrueKeyword)
	}
	options := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
		f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("requiresScope"), nil /*postfixToken*/, nil /*typeNode*/, requiresScope),
	}), false /*multiLine*/)
	return tx.runtimeCall("$using", scope, initializer, options)
}

// scoped reports whether the lowering of node belongs to a Scope region: node
// is a Scope region's block, a using statement in one, a fork it owns, or a
// loop that takes its values with using.
func (p *scopePlan) scoped(node *ast.Node) bool {
	return p.scopeBlocks[node] || p.usings[node] || p.forks[node] != nil || p.usingLoops[node]
}

// visitScoped lowers a node that scoped reports.
func (tx *lowering) visitScoped(node *ast.Node) *ast.Node {
	switch node.Kind {
	case ast.KindBlock:
		return tx.visitScopeBlock(node)
	case ast.KindVariableStatement:
		return tx.visitUsing(node)
	case ast.KindForOfStatement:
		return tx.visitUsingForOf(node)
	case ast.KindForStatement, ast.KindLabeledStatement:
		return tx.visitUsingFor(node)
	default:
		return tx.visitFork(node)
	}
}

// scopeName returns a new name for the Scope of the region that block runs
// in, and records it for the using statements and forks the block owns.
func (tx *lowering) scopeName(block *ast.Node) *ast.Node {
	scope := tx.Factory().NewUniqueName("scope")
	if tx.scopes == nil {
		tx.scopes = map[*ast.Node]*ast.Node{}
	}
	tx.scopes[block] = scope
	return scope
}

// scopeRegion makes `runtime.$region(Effect.fnUntraced(function* <name>$using(scope) {
// statements }))`, the Effect that runs a Scope region whose closure, with
// statements as its body, belongs to region r and lowers block.
func (tx *lowering) scopeRegion(r *region, scope *ast.Node, block *ast.Node, statements []*ast.Node) *ast.Node {
	f := tx.Factory()
	parameter := f.NewVariableDeclaration(scope, nil /*exclamationToken*/, nil /*typeNode*/, nil /*initializer*/)
	closure := tx.regionFunction(r, "using", parameter, block, statements)
	if usesThis(block) {
		closure = f.NewFunctionBindCall(closure, f.NewThisExpression(), nil /*argumentsList*/)
	}
	run := tx.runtimeCall("$region", closure)
	run.Loc = block.Loc // ends where the closure ends, so the printer does not repeat the comments after the block inside the call
	return run
}

// statementsOf returns the statements that node, a visited statement, stands
// for: the children of a SyntaxList, or node itself.
func statementsOf(node *ast.Node) []*ast.Node {
	switch {
	case node == nil:
		return nil
	case node.Kind == ast.KindSyntaxList:
		return node.AsSyntaxList().Children
	}
	return []*ast.Node{node}
}

// visitScopeBlock lowers block, a Scope region, to a region whose closure
// receives the region's Scope, run by the runtime's $region, which is
// Effect.scopedWith: it makes the Scope, does not add it to the Context, and
// closes it when the closure's Effect exits.
//
//	{ using conn = Pool.acquire(); if (retry) continue; work(conn) }
//
// becomes
//
//	{
//	  const completion = yield* runtime.$region(Effect.fnUntraced(function* attempt$using(scope) {
//	    const conn = yield* runtime.$using(scope, (yield* Pool).acquire());
//	    if (retry) return { kind: "continue", label: "" };
//	    yield* work(conn);
//	    return runtime.$normal;
//	  }));
//	  if (completion.kind === "continue" && completion.label === "") continue;
//	}
//
// A function body that is a Scope region needs no completion record, because
// a return from its closure is a return from the function:
//
//	return yield* runtime.$region(Effect.fnUntraced(function* serve$using(scope) { … }));
func (tx *lowering) visitScopeBlock(block *ast.Node) *ast.Node {
	f := tx.Factory()
	scope := tx.scopeName(block)
	fn := block.Parent
	isBody := fn != nil && isFunctionBoundary(fn) && fn.Body() == block
	r := &region{}
	saved := tx.frame
	if !isBody {
		tx.frame = &frame{name: saved.name, region: r, handleClause: saved.handleClause}
	}
	statements := tx.Visitor().VisitNodes(block.AsBlock().Statements).Nodes
	tx.frame = saved

	run := tx.scopeRegion(r, scope, block, statements)
	var lowered []*ast.Node
	if isBody {
		lowered = []*ast.Node{f.NewReturnStatement(f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), run))}
	} else {
		lowered = statementsOf(tx.runRegion(block, run, r))
	}
	result := f.NewBlock(f.NewNodeList(lowered), true /*multiLine*/)
	tx.EmitContext().SetOriginal(result, block)
	result.Loc = block.Loc
	return result
}

// visitScopeLoopBody lowers node, a loop body that is a statement other than
// a block and owns a fork, to the region of one iteration (D408), as
// visitScopeBlock lowers a block body: `for (const x of xs) fork work(x)`
// lowers as `for (const x of xs) { fork work(x) }` does, and a jump out of
// the statement leaves its region through a completion record.
func (tx *lowering) visitScopeLoopBody(node *ast.Node) *ast.Node {
	f := tx.Factory()
	scope := tx.scopeName(node)
	r := &region{}
	saved, savedLoop := tx.frame, tx.loopRegion
	tx.frame = &frame{name: saved.name, region: r, handleClause: saved.handleClause}
	tx.loopRegion = node
	statements := statementsOf(tx.Visitor().VisitNode(node))
	tx.frame, tx.loopRegion = saved, savedLoop
	run := tx.scopeRegion(r, scope, node, statements)
	result := f.NewBlock(f.NewNodeList(statementsOf(tx.runRegion(node, run, r))), true /*multiLine*/)
	tx.EmitContext().SetOriginal(result, node)
	result.Loc = node.Loc
	return result
}

// scopeBody returns body, the lowered block of an arrow function whose
// expression body source is a Scope region (D353), run in that region, whose
// Scope is scope: the arrow lowers as `() => { return fork p() }` does in
// visitScopeBlock,
//
//	() => fork p()
//
// becomes
//
//	() => { return yield* runtime.$region(Effect.fnUntraced(function* f$using(scope) {
//	  return yield* runtime.$fork(p(), scope);
//	})) }
//
// so the body interrupts the fiber when it exits. An expression has no jump
// to dispatch.
func (tx *lowering) scopeBody(source *ast.Node, scope *ast.Node, body *ast.Node) *ast.Node {
	f := tx.Factory()
	run := tx.scopeRegion(&region{}, scope, source, body.Statements())
	result := f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), run))}), false /*multiLine*/)
	tx.EmitContext().SetOriginal(result, source)
	result.Loc = body.Loc
	return result
}

// visitUsing lowers a using statement in a Scope region. Each declaration
// gets its value from the runtime's $using, which runs the acquisition with
// the region's Scope and releases a Disposable value with [Symbol.dispose]()
// when the region closes:
//
//	using file = Files.open(path), timer = startTimer()
//
// becomes, when Files.open returns an Effect and startTimer a Disposable,
//
//	const file = yield* runtime.$using(scope, (yield* Files).open(path)),
//	  timer = yield* runtime.$using(scope, Effect.succeed(startTimer()));
func (tx *lowering) visitUsing(node *ast.Node) *ast.Node {
	f := tx.Factory()
	scope := tx.scopes[node.Parent]
	if scope == nil {
		return tx.Visitor().VisitEachChild(node)
	}
	var declarations []*ast.Node
	for _, declaration := range node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
		value := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.usingCall(scope, declaration, tx.acquisition(declaration.Initializer())))
		declarations = append(declarations, f.NewVariableDeclaration(tx.Visitor().VisitNode(declaration.Name()), nil /*exclamationToken*/, nil /*typeNode*/, value))
	}
	statement := f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList(declarations), ast.NodeFlagsConst))
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// acquisition returns the program that $using runs for a using initializer,
// so that the whole initializer runs with the block's Scope, where the
// declaration stands (D401, D490). A call that runs an Effect, when nothing
// else in the initializer yields, is the Effect the call makes, not run;
// an initializer that runs nothing, v, is Effect.succeed(v); and any other
// initializer, such as a conditional, a comma expression, or a call whose
// operands run calls, is a program that evaluates it, each operand once and
// in source order:
//
//	using r = flag ? acquire() : open()
//
// becomes
//
//	const r = yield* runtime.$using(scope, Effect.gen(function* () {
//	  return flag ? yield* acquire() : yield* open();
//	}));
func (tx *lowering) acquisition(initializer *ast.Node) *ast.Node {
	f := tx.Factory()
	if initializer == nil {
		return tx.succeed(f.NewVoidZeroExpression())
	}
	if call := ast.SkipParentheses(initializer); call.Kind == ast.KindCallExpression {
		var program *ast.Node
		switch {
		case tx.plan.values[call]:
			program = tx.Visitor().VisitNode(call.Expression()) // p(), where p is an Effect value
		case tx.plan.runsCall(call):
			// Visit the call itself so module methods and other call rewrites
			// still apply, and defer only its outer run: $using supplies the
			// Scope before the acquisition runs.
			program = tx.Visitor().VisitNode(call)
			if program.Kind == ast.KindYieldExpression {
				program = program.Expression()
			}
		}
		if program != nil {
			if !containsYield(program) {
				return program
			}
			// Its callee or arguments run calls too, which must run with the
			// block's Scope, after the Scope is supplied.
			return tx.initializerProgram(initializer, f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), program))
		}
	}
	value := tx.Visitor().VisitNode(initializer)
	if !containsYield(value) {
		return tx.succeed(value)
	}
	return tx.initializerProgram(initializer, value)
}

// initializerProgram returns `Effect.gen(function* () { return value })`, the
// program of initializer, a using initializer whose lowered value runs
// calls, or `Effect.gen({ self: this }, function* () { return value })` when
// initializer refers to this, which the generator would not otherwise see.
func (tx *lowering) initializerProgram(initializer *ast.Node, value *ast.Node) *ast.Node {
	f := tx.Factory()
	ec := tx.EmitContext()
	// The initializer's leading comments are printed where it was written.
	// Printed again inside the program, a line comment between the return and
	// the value would end the return (byNameProgram).
	ec.AddEmitFlags(value, printer.EFNoLeadingComments)
	body := f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(value)}), false /*multiLine*/)
	generator := f.NewFunctionExpression(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), nil /*name*/, nil /*typeParameters*/, f.NewNodeList(nil), nil /*type*/, nil /*fullSignature*/, body)
	ec.SetOriginal(generator, initializer)
	tx.generated(generator)
	arguments := []*ast.Node{generator}
	if usesThis(initializer) {
		self := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{
			f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("self"), nil /*postfixToken*/, nil /*typeNode*/, f.NewThisExpression()),
		}), false /*multiLine*/)
		arguments = []*ast.Node{self, generator}
	}
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("gen"), ast.NodeFlagsNone)
	program := f.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
	ec.SetOriginal(program, initializer)
	program.Loc = initializer.Loc
	return program
}

// succeed makes `Effect.succeed(value)`.
func (tx *lowering) succeed(value *ast.Node) *ast.Node {
	f := tx.Factory()
	succeed := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("succeed"), ast.NodeFlagsNone)
	return f.NewCallExpression(succeed, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{value}), ast.NodeFlagsNone)
}

// visitFork lowers fork(program, options) in a Scope region to
// `yield* runtime.$fork(program, scope, options)`, Effect.forkIn with the
// region's Scope: the region interrupts the fiber when it closes, and waits
// for the fiber's cleanup.
func (tx *lowering) visitFork(node *ast.Node) *ast.Node {
	scope := tx.scopes[tx.plan.forks[node]]
	if scope == nil || len(node.Arguments()) == 0 {
		return tx.visitRunningCall(node)
	}
	visited := tx.Visitor().VisitNodes(node.ArgumentList()).Nodes
	arguments := append([]*ast.Node{visited[0], scope}, visited[1:]...)
	run := tx.Factory().NewYieldExpression(tx.Factory().NewToken(ast.KindAsteriskToken), tx.runtimeCall("$fork", arguments...))
	tx.EmitContext().SetOriginal(run, node)
	return run
}

// visitUsingForOf lowers `for (using x of values) body` in an Effect
// function. Each iteration's body is a Scope region that takes the value
// with using first, so the value is released when the iteration ends, by any
// path, after what the body acquired:
//
//	for (using conn of connections) { if (conn.closed) break; send(conn) }
//
// becomes
//
//	for (const value of connections) {
//	  const completion = yield* runtime.$region(Effect.fnUntraced(function* f$using(scope) {
//	    const conn = yield* runtime.$using(scope, Effect.succeed(value));
//	    if (conn.closed) return { kind: "break", label: "" };
//	    yield* send(conn);
//	    return runtime.$normal;
//	  }));
//	  if (completion.kind === "break" && completion.label === "") break;
//	}
//
// The using declarations and forks of a block body join the same region.
func (tx *lowering) visitUsingForOf(node *ast.Node) *ast.Node {
	if tx.plan.streamLoops[node] {
		return tx.visitStreamLoop(node) // $forOf closes the iterator or Stream on every exit (producers.go)
	}
	f := tx.Factory()
	loop := node.AsForInOrOfStatement()
	if len(loop.Initializer.AsVariableDeclarationList().Declarations.Nodes) == 0 {
		return tx.Visitor().VisitEachChild(node) // for (using of s): a syntax error the parser reported
	}
	expression := tx.Visitor().VisitNode(loop.Expression)
	value := f.NewUniqueName("value")

	// The loop is the target of the jumps its region dispatches, as
	// visitJumpTarget makes it for any other loop.
	tx.frame.targets = append(tx.frame.targets, target{loop: true})
	r := &region{}
	dispatched := statementsOf(tx.runRegion(loop.Statement, tx.usingIteration(r, node, value), r))
	tx.frame.targets = tx.frame.targets[:len(tx.frame.targets)-1]

	initializer := f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(value, nil /*exclamationToken*/, nil /*typeNode*/, nil /*initializer*/),
	}), ast.NodeFlagsConst)
	return f.UpdateForInOrOfStatement(loop, nil /*awaitModifier*/, initializer, expression, f.NewBlock(f.NewNodeList(dispatched), true /*multiLine*/))
}

// usingIteration makes the Scope region of one iteration of node, `for
// (using x of values) body`, whose closure belongs to region r: it takes
// value, the iteration's element, with using, then runs the body. A jump out
// of the body returns its completion record from the closure.
func (tx *lowering) usingIteration(r *region, node *ast.Node, value *ast.Node) *ast.Node {
	f := tx.Factory()
	loop := node.AsForInOrOfStatement()
	declaration := loop.Initializer.AsVariableDeclarationList().Declarations.Nodes[0]
	body := loop.Statement
	scope := tx.scopeName(body)
	saved := tx.frame
	tx.frame = &frame{name: saved.name, region: r, handleClause: saved.handleClause}
	using := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.usingCall(scope, declaration, tx.succeed(value)))
	statements := []*ast.Node{f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(tx.Visitor().VisitNode(declaration.Name()), nil /*exclamationToken*/, nil /*typeNode*/, using),
	}), ast.NodeFlagsConst))}
	if body.Kind == ast.KindBlock {
		statements = append(statements, tx.Visitor().VisitNodes(body.AsBlock().Statements).Nodes...)
	} else {
		statements = append(statements, statementsOf(tx.Visitor().VisitNode(body))...)
	}
	tx.frame = saved
	return tx.scopeRegion(r, scope, body, statements)
}

// visitUsingFor lowers `for (using x = value; test; step) body` in an Effect
// function, with the labels in front of it. JavaScript evaluates the head's
// using declarations once and disposes their values when the loop exits, so
// the loop runs in a Scope region that takes the values with using first:
//
//	outer: for (using conn = Pool.acquire(); conn.open; ) { if (done(conn)) return conn.id; poll(conn) }
//
// becomes
//
//	{
//	  const completion = yield* runtime.$region(Effect.fnUntraced(function* f$using(scope) {
//	    const conn = yield* runtime.$using(scope, (yield* Pool).acquire());
//	    outer: for (; conn.open;) {
//	      if (yield* done(conn)) return { kind: "return", value: conn.id };
//	      yield* poll(conn);
//	    }
//	    return runtime.$normal;
//	  }));
//	  if (completion.kind === "return") return completion.value;
//	}
//
// The region closes on every exit: the loop's end, a jump out of it, a
// failure, a defect, or an interruption.
func (tx *lowering) visitUsingFor(node *ast.Node) *ast.Node {
	f := tx.Factory()
	loop := labeledLoop(node)
	statement := loop.AsForStatement()
	scope := tx.scopeName(loop)

	r := &region{}
	saved := tx.frame
	tx.frame = &frame{name: saved.name, region: r, handleClause: saved.handleClause}
	var declarations []*ast.Node
	for _, declaration := range statement.Initializer.AsVariableDeclarationList().Declarations.Nodes {
		value := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.usingCall(scope, declaration, tx.acquisition(declaration.Initializer())))
		declarations = append(declarations, f.NewVariableDeclaration(tx.Visitor().VisitNode(declaration.Name()), nil /*exclamationToken*/, nil /*typeNode*/, value))
	}
	using := f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList(declarations), ast.NodeFlagsConst))
	tx.EmitContext().SetOriginal(using, statement.Initializer)
	using.Loc = statement.Initializer.Loc

	// The loop and its labels are jump targets inside the region's closure,
	// as visitJumpTarget makes them for any other loop.
	var labels []*ast.Node
	for n := node; n.Kind == ast.KindLabeledStatement; n = n.AsLabeledStatement().Statement {
		labels = append(labels, n)
		tx.frame.targets = append(tx.frame.targets, target{label: n.AsLabeledStatement().Label.Text(), loop: true})
	}
	tx.frame.targets = append(tx.frame.targets, target{loop: true})
	condition := tx.Visitor().VisitNode(statement.Condition)
	incrementor := tx.Visitor().VisitNode(statement.Incrementor)
	body := tx.Visitor().VisitEmbeddedStatement(statement.Statement)
	lowered := f.UpdateForStatement(statement, nil /*initializer*/, condition, incrementor, body)
	for i := len(labels) - 1; i >= 0; i-- {
		labeled := labels[i].AsLabeledStatement()
		lowered = f.UpdateLabeledStatement(labeled, labeled.Label, lowered)
	}
	tx.frame = saved

	run := tx.scopeRegion(r, scope, node, []*ast.Node{using, lowered})
	result := f.NewBlock(f.NewNodeList(statementsOf(tx.runRegion(node, run, r))), true /*multiLine*/)
	tx.EmitContext().SetOriginal(result, node)
	result.Loc = node.Loc
	return result
}
