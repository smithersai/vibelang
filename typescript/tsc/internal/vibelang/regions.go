package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// Regions.
//
// A region is a block of an Effect function that runs as an Effect of its
// own, so that a runtime helper can wrap it: the try, catch, and finally
// blocks of a try statement. A region compiles to a generator closure over
// the function's variables, wrapped with Effect.fnUntraced, so assignments
// inside it are visible after it:
//
//	try { return Users.find(id) } catch (e) { return guest } finally { log() }
//
// becomes
//
//	const completion = yield* runtime.$finally(runtime.$catch(
//	  Effect.fnUntraced(function* lookup$try() { return { kind: "return", value: yield* Users.find(id) } })(),
//	  Effect.fnUntraced(function* lookup$catch(e) { return { kind: "return", value: guest } })),
//	  Effect.fnUntraced(function* lookup$finally() { yield* log() })())
//	if (completion.kind === "return") return completion.value
//
// A return, break, or continue that leaves a region cannot jump out of its
// closure, so the closure returns a completion record instead: { kind:
// "return", value }, { kind: "break", label }, or { kind: "continue", label },
// with "" as the label of an unlabeled jump, and the runtime's $normal when
// the closure reaches its end. The generator that runs the region dispatches
// on the record: it returns, breaks, or continues itself, or, when it is a
// region's closure too and the jump leaves it as well, it returns the record
// to its own runner. A region that no jump leaves has no record to dispatch.
//
// The API for other region kinds (using, fork, and loops over producers):
// create a *region, emit each block with regionStatements, which collects the
// jumps that leave it, and regionFunction, compose the closures with runtime
// helpers, and run the result with runRegion.

// A jump is where a return, break, or continue statement goes.
type jump struct {
	kind  ast.Kind // ast.KindReturnStatement, ast.KindBreakStatement, or ast.KindContinueStatement
	label string   // the target label; "" for return and for an unlabeled break or continue
}

// A region collects the jumps that leave it while the lowering emits its
// closures.
type region struct {
	jumps []jump // each jump once, in the order the lowering met them
}

func (r *region) add(j jump) {
	if !slices.Contains(r.jumps, j) {
		r.jumps = append(r.jumps, j)
	}
}

// A frame is one generator function the lowering is emitting: an Effect
// function's own body, or the closure of a region.
type frame struct {
	name    string   // the Effect function's name, for naming region closures
	region  *region  // the region whose closure this is; nil for the function's own body
	targets []target // the statements a break or continue can jump to, innermost last
	clause  bool     // the generator is a handler clause's own body, where a return can resume in tail position
	// handleClause is the clause of a handle statement whose code this frame
	// emits: the clause's own frame and the frames of regions inside it.
	handleClause *clauseState
}

// A target is a statement that break or continue can jump to: a loop, a
// switch, or a labeled statement.
type target struct {
	label string // the label of a labeled statement; "" for a loop or a switch
	loop  bool   // continue can jump to it
}

// lands reports whether j lands in this generator, so that the generator can
// jump itself instead of returning a completion record.
func (f *frame) lands(j jump) bool {
	if j.kind == ast.KindReturnStatement {
		return f.region == nil
	}
	for i := len(f.targets) - 1; i >= 0; i-- {
		t := f.targets[i]
		switch {
		case j.label != "":
			if t.label == j.label {
				return true
			}
		case t.label == "" && (t.loop || j.kind == ast.KindBreakStatement):
			return true
		}
	}
	return false
}

// isJumpTarget reports whether node is a statement that break or continue can
// jump to.
func isJumpTarget(node *ast.Node) bool {
	return node.Kind == ast.KindLabeledStatement || node.Kind == ast.KindSwitchStatement || ast.IsIterationStatement(node, false /*lookInLabeledStatements*/)
}

// visitJumpTarget visits a loop, switch, or labeled statement in an Effect
// function, with the statement open as a jump target.
func (tx *lowering) visitJumpTarget(node *ast.Node) *ast.Node {
	t := target{loop: ast.IsIterationStatement(node, false /*lookInLabeledStatements*/)}
	if node.Kind == ast.KindLabeledStatement {
		statement := node.AsLabeledStatement()
		t = target{label: statement.Label.Text(), loop: ast.IsIterationStatement(statement.Statement, true /*lookInLabeledStatements*/)}
	}
	f := tx.frame
	f.targets = append(f.targets, t)
	visited := tx.Visitor().VisitEachChild(node)
	f.targets = f.targets[:len(f.targets)-1]
	return visited
}

// visitJump visits a return, break, or continue statement in a region's
// closure. A jump that leaves the region returns its completion record.
func (tx *lowering) visitJump(node *ast.Node) *ast.Node {
	j := jump{kind: node.Kind}
	if node.Kind != ast.KindReturnStatement {
		if label := node.Label(); label != nil {
			j.label = tx.closingLoopLabel(node, label.Text())
		}
	}
	if tx.frame.lands(j) || tx.frame.region == nil {
		// A jump with no target in the function's own body is an error the
		// checker reported (such as EK1903); emit it as written.
		return tx.Visitor().VisitEachChild(node)
	}
	var value *ast.Node
	if j.kind == ast.KindReturnStatement && node.Expression() != nil {
		value = tx.Visitor().VisitNode(node.Expression())
	}
	return tx.leave(j, value, node)
}

// jumpTo makes the statement that jumps to j, a break or continue, from the
// frame being emitted: the jump itself when it lands in the frame, and
// otherwise the return of its completion record. original is the node the
// jump stands for.
func (tx *lowering) jumpTo(j jump, original *ast.Node) *ast.Node {
	f := tx.Factory()
	if tx.frame.lands(j) {
		var label *ast.Node
		if j.label != "" {
			label = f.NewIdentifier(j.label)
		}
		if j.kind == ast.KindBreakStatement {
			return f.NewBreakStatement(label)
		}
		return f.NewContinueStatement(label)
	}
	return tx.leave(j, nil, original)
}

// leave makes the return of the completion record of j, which leaves the
// region whose closure the frame emits, with value as a return's value.
func (tx *lowering) leave(j jump, value *ast.Node, original *ast.Node) *ast.Node {
	tx.frame.region.add(j)
	f := tx.Factory()
	properties := []*ast.Node{f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("kind"), nil /*postfixToken*/, nil /*typeNode*/, f.NewStringLiteral(jumpKind(j.kind), ast.TokenFlagsNone))}
	if j.kind == ast.KindReturnStatement {
		if value != nil {
			properties = append(properties, f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("value"), nil /*postfixToken*/, nil /*typeNode*/, value))
		}
	} else {
		properties = append(properties, f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("label"), nil /*postfixToken*/, nil /*typeNode*/, f.NewStringLiteral(j.label, ast.TokenFlagsNone)))
	}
	record := f.NewReturnStatement(f.NewObjectLiteralExpression(f.NewNodeList(properties), false /*multiLine*/))
	tx.EmitContext().SetOriginal(record, original)
	record.Loc = original.Loc
	return record
}

func jumpKind(kind ast.Kind) string {
	switch kind {
	case ast.KindReturnStatement:
		return "return"
	case ast.KindBreakStatement:
		return "break"
	default:
		return "continue"
	}
}

// visitTryStatement lowers a try statement in an Effect function to regions:
// the try block runs under $catch when there is a catch clause, and under
// $finally when there is a finally block.
func (tx *lowering) visitTryStatement(node *ast.Node) *ast.Node {
	try := node.AsTryStatement()
	r := &region{}
	tryBlock := tx.regionStatements(r, try.TryBlock)
	var catchClause *ast.CatchClause
	var catchBlock []*ast.Node
	if try.CatchClause != nil {
		catchClause = try.CatchClause.AsCatchClause()
		catchBlock = tx.regionStatements(r, catchClause.Block)
	}
	// Every jump out of the try and catch blocks is known now, so each closure
	// that can reach its end knows whether it must return $normal.
	run := tx.runNow(tx.regionFunction(r, "try", nil, try.TryBlock, tryBlock), try.TryBlock)
	if catchClause != nil {
		handler := tx.regionFunction(r, "catch", catchClause.VariableDeclaration, catchClause.Block, catchBlock)
		if usesThis(catchClause.Block) {
			handler = tx.Factory().NewFunctionBindCall(handler, tx.Factory().NewThisExpression(), nil /*argumentsList*/)
		}
		helper := "$catch"
		if isCauseCatch(node) {
			helper = "$catchCause" // catch (cause: Cause) (primitives.go)
		}
		run = tx.runtimeCall(helper, run, handler)
	}
	if try.FinallyBlock != nil {
		cleanup := &region{}
		finallyBlock := tx.regionStatements(cleanup, try.FinallyBlock)
		if binding := exitBinding(try.FinallyBlock); binding != nil {
			// finally (exit) { ... }: the closure takes the Exit (primitives.go).
			finalizer := tx.regionFunction(cleanup, "finally", binding, try.FinallyBlock, finallyBlock)
			if usesThis(try.FinallyBlock) {
				finalizer = tx.Factory().NewFunctionBindCall(finalizer, tx.Factory().NewThisExpression(), nil /*argumentsList*/)
			}
			run = tx.runtimeCall("$finallyExit", run, finalizer)
		} else {
			run = tx.runtimeCall("$finally", run, tx.runNow(tx.regionFunction(cleanup, "finally", nil, try.FinallyBlock, finallyBlock), try.FinallyBlock))
		}
	}
	return tx.runRegion(node, run, r)
}

// regionStatements visits the statements of block as the body of a closure
// of region r. A block that declares using or calls fork is a Scope region
// inside r (scopes_lower.go).
func (tx *lowering) regionStatements(r *region, block *ast.Node) []*ast.Node {
	saved := tx.frame
	tx.frame = &frame{name: saved.name, region: r, handleClause: saved.handleClause}
	var statements []*ast.Node
	if tx.plan.scopeBlocks[block] {
		statements = tx.visitScopeBlock(block).AsBlock().Statements.Nodes
	} else {
		statements = tx.Visitor().VisitNodes(block.AsBlock().Statements).Nodes
	}
	tx.frame = saved
	return statements
}

// regionFunction makes `Effect.fnUntraced(function* <name>$<role>(binding) {
// statements })`, a closure of region r whose body is statements, the visited
// statements of block. binding is the variable declaration whose name the
// closure takes as its parameter, a catch clause's or a Scope region's scope,
// or nil. When a jump leaves r, a closure that can reach its end returns
// $normal there. The generator's name binds in its body, so it is fresh
// (hygiene.go): work$try$1 when the file spells work$try.
func (tx *lowering) regionFunction(r *region, role string, binding *ast.Node, block *ast.Node, statements []*ast.Node) *ast.Node {
	f := tx.Factory()
	var parameters []*ast.Node
	if binding != nil {
		name := binding.Name()
		if ast.IsBindingPattern(name) {
			// catch ({ a = f() }): a pattern's defaults may run calls, which a
			// generator's parameter list cannot yield, so the body destructures.
			error := f.NewUniqueName("error")
			destructure := f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
				f.NewVariableDeclaration(tx.visitInFrame(r, name), nil /*exclamationToken*/, nil /*typeNode*/, error),
			}), ast.NodeFlagsConst))
			statements = append([]*ast.Node{destructure}, statements...)
			name = error
		}
		parameters = append(parameters, f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, name, nil /*questionToken*/, nil /*typeNode*/, nil /*initializer*/))
	}
	if len(r.jumps) > 0 && canCompleteNormally(block) {
		statements = append(statements, tx.generated(f.NewReturnStatement(tx.runtimeMember("$normal"))))
	}
	body := f.NewBlock(f.NewNodeList(statements), true /*multiLine*/)
	body.Loc = block.Loc
	var name *ast.Node
	if tx.frame.name != "" {
		name = f.NewIdentifier(tx.freshName(tx.frame.name + "$" + role))
	}
	generator := f.NewFunctionExpression(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), name, nil /*typeParameters*/, f.NewNodeList(parameters), nil /*type*/, nil /*fullSignature*/, body)
	tx.EmitContext().SetOriginal(generator, block)
	tx.generated(generator)
	return tx.wrapGenerator("fnUntraced", block, generator)
}

// visitInFrame visits node as code of region r's closure.
func (tx *lowering) visitInFrame(r *region, node *ast.Node) *ast.Node {
	saved := tx.frame
	tx.frame = &frame{name: saved.name, region: r, handleClause: saved.handleClause}
	visited := tx.Visitor().VisitNode(node)
	tx.frame = saved
	return visited
}

// runRegion makes the statements that run run, a region's Effect, in the
// enclosing generator, and dispatch every jump that leaves region r:
//
//	const completion = yield* run
//	if (completion.kind === "return") return completion.value
//	if (completion.kind === "break" && completion.label === "outer") break outer
//
// A jump that leaves the enclosing generator too, when it is a region's
// closure, returns the record again.
func (tx *lowering) runRegion(original *ast.Node, run *ast.Node, r *region) *ast.Node {
	f := tx.Factory()
	ec := tx.EmitContext()
	yield := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), run)
	if len(r.jumps) == 0 {
		statement := f.NewExpressionStatement(yield)
		ec.SetOriginal(statement, original)
		statement.Loc = original.Loc
		return statement
	}
	completion := f.NewUniqueName("completion")
	declaration := f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(completion, nil /*exclamationToken*/, nil /*typeNode*/, yield),
	}), ast.NodeFlagsConst))
	ec.SetOriginal(declaration, original)
	declaration.Loc = original.Loc
	statements := []*ast.Node{declaration}
	for _, j := range r.jumps {
		statements = append(statements, tx.dispatch(completion, j))
	}
	return f.NewSyntaxList(statements)
}

// dispatch makes `if (<completion is j>) <jump>` for one jump that leaves a
// region.
func (tx *lowering) dispatch(completion *ast.Node, j jump) *ast.Node {
	f := tx.Factory()
	member := func(name string) *ast.Node {
		return f.NewPropertyAccessExpression(completion, nil /*questionDotToken*/, f.NewIdentifier(name), ast.NodeFlagsNone)
	}
	test := f.NewStrictEqualityExpression(member("kind"), f.NewStringLiteral(jumpKind(j.kind), ast.TokenFlagsNone))
	if j.kind != ast.KindReturnStatement {
		test = f.NewLogicalANDExpression(test, f.NewStrictEqualityExpression(member("label"), f.NewStringLiteral(j.label, ast.TokenFlagsNone)))
	}
	var then *ast.Node
	switch {
	case !tx.frame.lands(j) && tx.frame.region != nil:
		tx.frame.region.add(j)
		then = f.NewReturnStatement(completion)
	case j.kind == ast.KindReturnStatement:
		then = f.NewReturnStatement(member("value"))
	default:
		// A break or continue that lands here, or that has no target in the
		// function at all, an error the checker reported (TS1105, TS1107,
		// TS1116), which is emitted as written, as visitJump does.
		var label *ast.Node
		if j.label != "" {
			label = f.NewIdentifier(j.label)
		}
		if j.kind == ast.KindBreakStatement {
			then = f.NewBreakStatement(label)
		} else {
			then = f.NewContinueStatement(label)
		}
	}
	return f.NewIfStatement(test, then, nil /*elseStatement*/)
}

// runNow makes `fn()`, which makes the Effect that fn, the closure of block,
// runs, or `fn.call(this)` when block refers to this, so the closure sees the
// function's this.
func (tx *lowering) runNow(fn *ast.Node, block *ast.Node) *ast.Node {
	f := tx.Factory()
	if usesThis(block) {
		return f.NewFunctionCallCall(fn, f.NewThisExpression(), nil /*argumentsList*/)
	}
	return f.NewCallExpression(fn, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(nil), ast.NodeFlagsNone)
}

// canCompleteNormally reports whether statement can reach its end, so control
// continues after it. It looks only at syntax and answers true when unsure.
func canCompleteNormally(statement *ast.Node) bool {
	if statement == nil {
		return true
	}
	switch statement.Kind {
	case ast.KindReturnStatement, ast.KindThrowStatement, ast.KindBreakStatement, ast.KindContinueStatement:
		return false
	case ast.KindBlock:
		for _, s := range statement.AsBlock().Statements.Nodes {
			if !canCompleteNormally(s) {
				return false
			}
		}
		return true
	case ast.KindIfStatement:
		s := statement.AsIfStatement()
		return s.ElseStatement == nil || canCompleteNormally(s.ThenStatement) || canCompleteNormally(s.ElseStatement)
	case ast.KindTryStatement:
		s := statement.AsTryStatement()
		body := canCompleteNormally(s.TryBlock) || s.CatchClause != nil && canCompleteNormally(s.CatchClause.AsCatchClause().Block)
		return body && canCompleteNormally(s.FinallyBlock)
	}
	return true
}

// varList returns the var declaration list that node declares in a region's
// closure, or nil: node is a var statement, or the var list that initializes
// a for, for...in, or for...of loop.
func varList(node *ast.Node) *ast.Node {
	var list *ast.Node
	switch node.Kind {
	case ast.KindVariableStatement:
		list = node.AsVariableStatement().DeclarationList
	case ast.KindVariableDeclarationList:
		if parent := node.Parent; parent != nil && (parent.Kind == ast.KindForStatement || parent.Kind == ast.KindForInStatement || parent.Kind == ast.KindForOfStatement) {
			list = node
		}
	}
	if list == nil || list.Flags&ast.NodeFlagsBlockScoped != 0 {
		return nil
	}
	return list
}

// visitVar lowers a var declaration in a region's closure. A var belongs to
// the whole function, and the closure would make it its own, so the lowering
// declares the names in the Effect function and assigns them where the source
// declared them: `var x = f()` becomes `x = yield* f()`. A var list that
// initializes a for...in or for...of loop becomes the loop's target.
func (tx *lowering) visitVar(node *ast.Node) *ast.Node {
	f := tx.Factory()
	list := varList(node)
	var assignments []*ast.Node
	for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
		tx.hoist(declaration.Name())
		target := tx.Visitor().VisitNode(declaration.Name())
		if ast.IsBindingPattern(target) {
			target = transformers.ConvertBindingPatternToAssignmentPattern(tx.EmitContext(), target.AsBindingPattern())
		}
		if node.Kind == ast.KindVariableDeclarationList && node.Parent.Kind != ast.KindForStatement {
			return target // for (var x of xs): exactly one declaration, without initializer
		}
		if initializer := declaration.Initializer(); initializer != nil {
			assignments = append(assignments, f.NewAssignmentExpression(target, tx.Visitor().VisitNode(initializer)))
		}
	}
	if len(assignments) == 0 {
		return nil
	}
	expression := f.InlineExpressions(assignments)
	if node.Kind == ast.KindVariableDeclarationList {
		return expression
	}
	statement := f.NewExpressionStatement(expression)
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// hoist declares each name that name binds as a var of the Effect function.
func (tx *lowering) hoist(name *ast.Node) {
	if ast.IsIdentifier(name) {
		tx.EmitContext().AddVariableDeclaration(tx.Factory().NewIdentifier(name.Text()))
		return
	}
	for _, element := range name.AsBindingPattern().Elements.Nodes {
		if element.Name() != nil {
			tx.hoist(element.Name())
		}
	}
}

// Plain-JavaScript regions (D54). A function that compiles to plain
// JavaScript cannot pause, so its try, catch, and finally stay JavaScript's.
// Every throw in it is caught by one of its own catch clauses, or it would be
// an Effect, so its throws mark the thrown value as an expected failure, and
// its catch clauses rethrow anything else, a defect, as D13 requires:
//
//	try { if (n > 0) throw new Invalid() } catch (e) { return -1 }
//
// becomes
//
//	try { if (n > 0) throw runtime.$expected(new Invalid()) } catch (e) { e = runtime.$caught(e); return -1 }
//
// What plain code throws stands for the Cause a frame would carry, so the
// runtime decides what a catch recovers as $catch does. A finally block keeps
// JavaScript's meaning (VIP-4): a return, break, continue, or throw in it
// replaces the completion in flight, a throw or a return, which is discarded.

// visitPlainThrowStatement turns `throw e` into `throw runtime.$expected(e)`.
func (tx *lowering) visitPlainThrowStatement(node *ast.Node) *ast.Node {
	statement := tx.Factory().NewThrowStatement(tx.runtimeCall("$expected", tx.Visitor().VisitNode(node.Expression())))
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// visitPlainCatchClause makes a catch clause start with `runtime.$caught`, which
// returns the expected failure it caught or rethrows a defect.
func (tx *lowering) visitPlainCatchClause(node *ast.Node) *ast.Node {
	f := tx.Factory()
	clause := node.AsCatchClause()
	declaration := clause.VariableDeclaration
	var unwrap *ast.Node
	switch {
	case declaration != nil && ast.IsIdentifier(declaration.Name()):
		// catch (e) { e = runtime.$caught(e); ... }
		name := declaration.Name().Text()
		unwrap = f.NewExpressionStatement(f.NewAssignmentExpression(f.NewIdentifier(name), tx.runtimeCall("$caught", f.NewIdentifier(name))))
		declaration = tx.Visitor().VisitNode(declaration)
	default:
		// catch ({ id }) { const { id } = runtime.$caught(error); ... }, and
		// catch { ... } as catch (error) { runtime.$caught(error); ... }
		error := f.NewUniqueName("error")
		if declaration != nil {
			unwrap = f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
				f.NewVariableDeclaration(tx.Visitor().VisitNode(declaration.Name()), nil /*exclamationToken*/, nil /*typeNode*/, tx.runtimeCall("$caught", error)),
			}), ast.NodeFlagsConst))
		} else {
			unwrap = f.NewExpressionStatement(tx.runtimeCall("$caught", error))
		}
		declaration = f.NewVariableDeclaration(error, nil /*exclamationToken*/, nil /*typeNode*/, nil /*initializer*/)
	}
	block := tx.Visitor().VisitNode(clause.Block)
	statements := append([]*ast.Node{unwrap}, block.AsBlock().Statements.Nodes...)
	block = f.UpdateBlock(block.AsBlock(), f.NewNodeList(statements), true /*multiLine*/)
	return f.UpdateCatchClause(clause, declaration, block)
}

func init() {
	fileChecks = append(fileChecks, checkFinallyJumps)
}

// checkFinallyJumps reports EK2006 at each return, break, or continue that
// leaves a finally block of effect code, where the block runs as $finally's
// Effect.onExit and the jump would discard a failure in flight (D15). Plain
// code keeps JavaScript's finally (VIP-4), where such a jump replaces the
// completion in flight.
func checkFinallyJumps(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindTryStatement && node.AsTryStatement().FinallyBlock != nil && inLowerableBody(node) && inEffectCode(a, node) {
			forEachJumpLeaving(node.AsTryStatement().FinallyBlock, func(jump *ast.Node) {
				keyword := jumpKind(jump.Kind)
				d := reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, jump.Pos()), EK2006, keyword)
				note(d, "Move the {0} after the try statement.", keyword)
			})
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// inEffectCode reports whether node, in a lowerable body, is effect code: its
// function is marked effect, or compiles to an Effect frame. A marked
// function's plain variant changes no diagnostic (D421).
func inEffectCode(a *analyzer, node *ast.Node) bool {
	fn := enclosingFunction(node)
	return isMarkedEffect(fn) || !a.compilesToPlain(fn)
}

// forEachJumpLeaving calls fn with each return, break, or continue in block,
// outside the functions nested in it, whose target is outside block.
func forEachJumpLeaving(block *ast.Node, fn func(jump *ast.Node)) {
	f := &frame{region: &region{}}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isFunctionBoundary(node):
			return false
		case node.Kind == ast.KindReturnStatement || ast.IsBreakOrContinueStatement(node):
			j := jump{kind: node.Kind}
			if node.Kind != ast.KindReturnStatement && node.Label() != nil {
				j.label = node.Label().Text()
			}
			if !f.lands(j) {
				fn(node)
			}
		case isJumpTarget(node):
			t := target{loop: ast.IsIterationStatement(node, false /*lookInLabeledStatements*/)}
			if node.Kind == ast.KindLabeledStatement {
				statement := node.AsLabeledStatement()
				t = target{label: statement.Label.Text(), loop: ast.IsIterationStatement(statement.Statement, true /*lookInLabeledStatements*/)}
			}
			f.targets = append(f.targets, t)
			node.ForEachChild(visit)
			f.targets = f.targets[:len(f.targets)-1]
			return false
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
}
