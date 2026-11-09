package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Handle statements (D132), the statement form of handle:
//
//	try {
//	  return release(version)
//	} handle Approval.approve(request) {
//	  resume(true)
//	}
//
// runs the try block with a deep handler for Approval, as
// handle(() => release(version), Approval, { approve(request, k) { return resume(k, true) } })
// would, except that the block and the clauses are code of the enclosing
// function: a return returns from it, and a break or continue leaves its
// loops. The parser (internal/parser/vibelang.go) reads the statement as a try
// statement flagged NodeFlagsVibeLang whose catch block holds the clauses, each
// an if branch that starts with `const [$k, request] = $clause(Approval.approve)`,
// so the checker's flow analysis lets a clause start anywhere in the block.
//
// In a clause, resume(value) continues the block. When the block finishes,
// the clause goes on after the resume, and when the clause ends, the
// statement ends as the block did: a return in the block returns once the
// clause is done, as a pending return waits for a finally block. A clause
// that ends without resuming abandons the block, whose cleanup runs, and the
// statement completes normally. A return, break, or continue in the clause
// leaves the statement at once, like one in a finally block.
//
// The lowering runs the block as a region closure under the runtime's handle,
// one call per control, the first control innermost, and each clause as a
// generator that returns the completion record of the statement:
//
//	const completion = yield* runtime.handle(Effect.fnUntraced(function* f$try() {
//	  return { kind: "return", value: yield* release(version) };
//	})(), Approval, {
//	  approve: Effect.fnUntraced(function* f$approve(...args) {
//	    const [$k, request] = [args.pop(), ...args];
//	    return runtime.$tailResume($k, true);
//	  })
//	});
//	if (completion.kind === "return") return completion.value;
//
// A resume in tail position of the clause's own frame returns the kernel's
// tail-resume request (D18). Any other resume stores what it returns, the
// block's completion record, in a variable the clause returns at its end,
// and evaluates to the record's value (undefined for other completions). A
// tail resume inside a region of the clause, such as a using block, does the
// same and then breaks out of a block labeled $clause that holds the clause.

func init() { fileChecks = append(fileChecks, checkHandleStatements) }

// isHandleStatement reports whether node is a handle statement: the try
// statement, flagged NodeFlagsVibeLang, that the parser writes for
// `try { … } handle Control.operation(…) { … }`.
func isHandleStatement(node *ast.Node) bool {
	return node.Kind == ast.KindTryStatement && node.Flags&ast.NodeFlagsVibeLang != 0
}

// isClauseBinding reports whether node is the statement that binds a handle
// clause's continuation and parameters.
func isClauseBinding(node *ast.Node) bool {
	return node.Kind == ast.KindVariableStatement && node.Flags&ast.NodeFlagsVibeLang != 0
}

// catches reports whether try, a try statement, has a catch clause that
// handles failures. A handle statement's catch clause holds its clauses,
// which handle operations, not failures.
func catches(try *ast.Node) bool {
	return try.AsTryStatement().CatchClause != nil && !isHandleStatement(try)
}

// isClauseOperation reports whether node is the operation a handle clause
// answers, Approval.approve in `$clause(Approval.approve)`. The checker reads
// its type from the control's shape, as at a member call (memberReceiver).
func isClauseOperation(node *ast.Node) bool {
	call := node.Parent
	return ast.IsPropertyAccessExpression(node) && call != nil && ast.IsCallExpression(call) && isClauseCallee(call.Expression()) &&
		len(call.Arguments()) == 1 && call.Arguments()[0] == node
}

// isClauseCallee reports whether node is the $clause that the parser writes
// in a handle clause's binding.
func isClauseCallee(node *ast.Node) bool {
	return ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed != 0 && node.Text() == "$clause"
}

// isClauseContinuation reports whether node is the continuation, $k, that the
// parser passes to a resume in a handle statement's clause.
func isClauseContinuation(node *ast.Node) bool {
	return ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed != 0 && node.Text() == "$k"
}

// handleClauseOfBlock returns the operation that node answers, Approval.approve,
// when node is the block of a handle statement's clause, or nil.
func handleClauseOfBlock(node *ast.Node) *ast.Node {
	if node.Kind != ast.KindBlock || len(node.AsBlock().Statements.Nodes) == 0 || !isClauseBinding(node.AsBlock().Statements.Nodes[0]) {
		return nil
	}
	return node.AsBlock().Statements.Nodes[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer().Arguments()[0]
}

// A handleClause is one clause of a handle statement.
type handleClause struct {
	block     *ast.Node // the clause's block; its first statement is the binding
	operation *ast.Node // Approval.approve
	control   *ast.Node // Approval
	name      string    // approve
}

// handleClauses returns the clauses of node, a handle statement, in source
// order.
func handleClauses(node *ast.Node) []handleClause {
	var clauses []handleClause
	chain := node.AsTryStatement().CatchClause.AsCatchClause().Block.AsBlock().Statements.Nodes[0]
	for ; chain != nil; chain = chain.AsIfStatement().ElseStatement {
		block := chain.AsIfStatement().ThenStatement
		operation := handleClauseOfBlock(block)
		clauses = append(clauses, handleClause{block: block, operation: operation, control: operation.Expression(), name: operation.Name().Text()})
	}
	return clauses
}

// controlGroups returns the indexes of clauses grouped by the control they
// name, in the order each control first appears.
func controlGroups(clauses []handleClause) [][]int {
	var groups [][]int
	index := map[string]int{}
	for i, clause := range clauses {
		key := entityText(clause.control)
		g, ok := index[key]
		if !ok {
			g = len(groups)
			index[key] = g
			groups = append(groups, nil)
		}
		groups[g] = append(groups[g], i)
	}
	return groups
}

// entityText returns the text of an entity name expression, such as
// Approval or controls.Approval.
func entityText(node *ast.Node) string {
	switch {
	case ast.IsIdentifier(node):
		return node.Text()
	case ast.IsPropertyAccessExpression(node):
		return entityText(node.Expression()) + "." + node.Name().Text()
	}
	return ""
}

// handleFlow collects what can escape a handle statement: the failures of
// its block and clauses, and their requirements other than the controls the
// statement handles. Each control's handler encloses those of the controls
// before it, so a clause's own operations reach the handlers of the controls
// after its own.
func (a *analyzer) handleFlow(node *ast.Node) *effectInfo {
	c := a.checker
	clauses := handleClauses(node)
	info := a.flowOf(node.AsTryStatement().TryBlock)
	for _, group := range controlGroups(clauses) {
		if identifier, _ := serviceOfKey(c, c.GetTypeAtLocation(clauses[group[0]].control)); identifier != nil {
			info = withoutRequirement(c, info, identifier)
		}
		for _, i := range group {
			info.add(a.flowOf(clauses[i].block))
		}
	}
	return info
}

// withoutRequirement returns info without the requirements that are handled,
// the members of its requirements that have type handled.
func withoutRequirement(c *checker.Checker, info *effectInfo, handled *checker.Type) *effectInfo {
	out := &effectInfo{effect: info.effect}
	out.addErrors(info)
	for i, requirement := range info.requirements {
		for _, member := range unionMembers(requirement) {
			if !c.IsTypeAssignableTo(member, handled) {
				out.addRequirement(member, info.requirementSources[i])
			}
		}
	}
	return out
}

// checkHandleStatements checks control clauses during legacy source recovery.
func checkHandleStatements(c *checker.Checker, file *ast.SourceFile) {
	var visit func(n *ast.Node, inFunction bool) bool
	visit = func(n *ast.Node, inFunction bool) bool {
		if isHandleStatement(n) {
			if !inFunction {
				cover(c, n.AsTryStatement().CatchClause) // TypeScript's errors about a clause's return outside a function
			}
			checkHandleClauses(c, n)
		}
		inner := inFunction || ast.IsFunctionLike(n)
		return n.ForEachChild(func(child *ast.Node) bool { return visit(child, inner) })
	}
	file.AsNode().ForEachChild(func(n *ast.Node) bool { return visit(n, false) })
}

// checkHandleClauses checks the clauses of node, a handle statement, control
// by control.
func checkHandleClauses(c *checker.Checker, node *ast.Node) {
	clauses := handleClauses(node)
	for _, group := range controlGroups(clauses) {
		control := clauses[group[0]].control
		_, shape := serviceOfKey(c, c.GetTypeAtLocation(control))
		if shape == nil || !isControlDeclaration(c, control) {
			d := report(c, control, EK2107, entityText(control))
			if shape != nil {
				note(d, "A service's members return to their caller once. Provide {0} with a layer or a provide block.", entityText(control))
			}
			continue
		}
		answered := map[string]bool{}
		for _, i := range group {
			if answered[clauses[i].name] {
				note(report(c, clauses[i].operation.Name(), EK2108.With("{0} already has a clause in this statement."), entityText(clauses[i].operation)), "Remove one of them: a handle statement answers each operation once.")
			}
			answered[clauses[i].name] = true
		}
		var missing []string
		for _, property := range c.GetPropertiesOfType(shape) {
			if name := property.Name(); !checker.IsServiceBrandProperty(property) && !answered[name] {
				missing = append(missing, entityText(control)+"."+name)
			}
		}
		if len(missing) > 0 {
			d := report(c, control, EK2108, strings.Join(missing, ", "), entityText(control))
			note(d, "Add a handle clause for each, or handle the operation with handle(program, {0}, clauses).", entityText(control))
		}
	}
}

// isControlDeclaration reports whether control, a handle clause's control,
// names a control declaration. A class declared outside a .vibe file,
// such as one a compiled package's declaration file describes, counts: the
// checker cannot tell its kind, and the runtime checks it.
func isControlDeclaration(c *checker.Checker, control *ast.Node) bool {
	symbol := c.GetSymbolAtLocation(control)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.ValueDeclaration() == nil {
		return false
	}
	declaration := symbol.ValueDeclaration()
	if !isVibeLangFile(ast.GetSourceFileOfNode(declaration)) {
		return ast.IsClassLike(declaration)
	}
	return classKindOf(declaration) == controlClass
}

// A clauseState is what the lowering keeps while it emits one clause of a
// handle statement. Every region frame inside the clause shares it.
type clauseState struct {
	frame    *frame    // the clause's own frame
	pending  *ast.Node // the variable that holds the completion record a resume returned, once one needs it
	labelled bool      // a tail resume inside a region breaks out of the $clause block
}

// clauseLabel labels the block that holds a clause's statements, when a tail
// resume inside one of its regions must end the clause.
const clauseLabel = "$clause"

// isClauseResume reports whether expression, looking through parentheses, is
// a resume or resumeWith that the parser gave a handle clause's
// continuation, $k.
func (tx *lowering) isClauseResume(expression *ast.Node) bool {
	if expression == nil {
		return false
	}
	call := ast.SkipParentheses(expression)
	if !ast.IsCallExpression(call) || tx.plan.resumes[call] == "" || len(call.Arguments()) == 0 {
		return false
	}
	return isClauseContinuation(call.Arguments()[0])
}

// visitHandleStatement lowers node, a handle statement.
func (tx *lowering) visitHandleStatement(node *ast.Node) *ast.Node {
	f := tx.Factory()
	try := node.AsTryStatement()
	clauses := handleClauses(node)
	r := &region{}
	body := tx.regionStatements(r, try.TryBlock)
	states := make([]*clauseState, len(clauses))
	statements := make([][]*ast.Node, len(clauses))
	bindings := make([]*ast.Node, len(clauses))
	for i, clause := range clauses {
		states[i], bindings[i], statements[i] = tx.clauseStatements(r, clause)
	}
	// Every jump out of the block and the clauses is known now.
	run := tx.runNow(tx.regionFunction(r, "try", nil, try.TryBlock, body), try.TryBlock)
	for _, group := range controlGroups(clauses) {
		var properties []*ast.Node
		for _, i := range group {
			clause := tx.clauseFunction(r, clauses[i], states[i], bindings[i], statements[i])
			properties = append(properties, f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier(clauses[i].name), nil /*postfixToken*/, nil /*typeNode*/, clause))
		}
		control := tx.Visitor().VisitNode(clauses[group[0]].control)
		run = tx.runtimeCall("handle", run, control, f.NewObjectLiteralExpression(f.NewNodeList(properties), true /*multiLine*/))
	}
	return tx.runRegion(node, run, r)
}

// clauseStatements visits the statements of clause, a handle clause, as the
// body of its generator, a closure of region r. It returns the clause's
// state, its visited binding pattern, and its visited statements.
func (tx *lowering) clauseStatements(r *region, clause handleClause) (*clauseState, *ast.Node, []*ast.Node) {
	saved := tx.frame
	own := &frame{name: saved.name, region: r, targets: []target{{label: clauseLabel}}}
	state := &clauseState{frame: own}
	own.handleClause = state
	tx.frame = own
	binding := clause.block.AsBlock().Statements.Nodes[0]
	pattern := tx.Visitor().VisitNode(binding.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Name())
	var statements []*ast.Node
	if tx.plan.scopeBlocks[clause.block] {
		statements = tx.visitScopeBlock(clause.block).AsBlock().Statements.Nodes
	} else {
		statements = tx.Visitor().VisitNodes(clause.block.AsBlock().Statements).Nodes
	}
	tx.frame = saved
	return state, pattern, statements
}

// clauseFunction makes the generator of clause, which the runtime's handle
// calls with the operation's arguments and then the continuation:
//
//	Effect.fnUntraced(function* f$approve(...args) {
//	  const [$k, request] = [args.pop(), ...args];
//	  let pending = runtime.$normal;
//	  $clause: { statements }
//	  return pending;
//	})
//
// The pending variable is there when a resume needs it, and the labeled
// block when a tail resume inside a region breaks out of it.
func (tx *lowering) clauseFunction(r *region, clause handleClause, state *clauseState, pattern *ast.Node, statements []*ast.Node) *ast.Node {
	f := tx.Factory()
	args := f.NewUniqueName("args")
	pop := f.NewCallExpression(f.NewPropertyAccessExpression(args, nil /*questionDotToken*/, f.NewIdentifier("pop"), ast.NodeFlagsNone), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(nil), ast.NodeFlagsNone)
	arguments := f.NewArrayLiteralExpression(f.NewNodeList([]*ast.Node{pop, f.NewSpreadElement(args)}), false /*multiLine*/)
	body := []*ast.Node{f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
		f.NewVariableDeclaration(pattern, nil /*exclamationToken*/, nil /*typeNode*/, arguments),
	}), ast.NodeFlagsConst))}
	if state.pending != nil {
		body = append(body, f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
			f.NewVariableDeclaration(state.pending, nil /*exclamationToken*/, nil /*typeNode*/, tx.runtimeMember("$normal")),
		}), ast.NodeFlagsLet)))
	}
	if state.labelled {
		block := f.NewBlock(f.NewNodeList(statements), true /*multiLine*/)
		body = append(body, f.NewLabeledStatement(f.NewIdentifier(clauseLabel), block))
	} else {
		body = append(body, statements...)
	}
	reachesEnd := state.labelled || canCompleteNormally(clause.block)
	switch {
	case state.pending != nil && reachesEnd:
		body = append(body, f.NewReturnStatement(state.pending))
	case len(r.jumps) > 0 && reachesEnd:
		body = append(body, tx.generated(f.NewReturnStatement(tx.runtimeMember("$normal"))))
	}
	block := f.NewBlock(f.NewNodeList(body), true /*multiLine*/)
	block.Loc = clause.block.Loc
	var name *ast.Node
	if tx.frame.name != "" {
		name = f.NewIdentifier(tx.freshName(tx.frame.name + "$" + clause.name)) // fresh, as a region's (regionFunction)
	}
	rest := f.NewParameterDeclaration(nil /*modifiers*/, f.NewToken(ast.KindDotDotDotToken), args, nil /*questionToken*/, nil /*typeNode*/, nil /*initializer*/)
	generator := f.NewFunctionExpression(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), name, nil /*typeParameters*/, f.NewNodeList([]*ast.Node{rest}), nil /*type*/, nil /*fullSignature*/, block)
	tx.EmitContext().SetOriginal(generator, clause.block)
	tx.generated(generator)
	tx.lexicalReceiver(generator)
	lowered := tx.wrapGenerator("fnUntraced", clause.block, generator)
	return lowered
}

// pendingOf returns the variable of state that holds what a resume returned,
// creating it on first use.
func (tx *lowering) pendingOf(state *clauseState) *ast.Node {
	if state.pending == nil {
		state.pending = tx.Factory().NewUniqueName("pending")
	}
	return state.pending
}

// visitClauseResume lowers any non-tail resume or resumeWith in a handle
// clause to `(pending = yield* resume(...))?.value`. The clause keeps the
// block's completion for its end, while the expression sees only its value.
// A block with no outgoing jumps may return undefined instead of $normal.
func (tx *lowering) visitClauseResume(node *ast.Node) *ast.Node {
	f := tx.Factory()
	run := tx.visitRunningCall(node)
	store := f.NewParenthesizedExpression(f.NewAssignmentExpression(tx.pendingOf(tx.frame.handleClause), run))
	value := f.NewPropertyAccessExpression(store, f.NewToken(ast.KindQuestionDotToken), f.NewIdentifier("value"), ast.NodeFlagsOptionalChain)
	tx.EmitContext().SetOriginal(value, node)
	value.Loc = node.Loc
	return value
}

// visitClauseResumeReturn lowers `return resume($k, value)`, a resume in
// tail position of a handle clause. In the clause's own frame it returns the
// kernel's tail-resume request. Inside a region of the clause, whose cleanup
// must run after the resumed block, it stores what resume returns and breaks
// out of the clause's labeled block.
func (tx *lowering) visitClauseResumeReturn(node *ast.Node) *ast.Node {
	state := tx.frame.handleClause
	if tx.frame == state.frame {
		return tx.visitTailResumeReturn(node)
	}
	f := tx.Factory()
	store := f.NewExpressionStatement(f.NewAssignmentExpression(tx.pendingOf(state), tx.visitRunningCall(ast.SkipParentheses(node.Expression()))))
	tx.EmitContext().SetOriginal(store, node)
	store.Loc = node.Loc
	state.labelled = true
	return f.NewSyntaxList([]*ast.Node{store, tx.jumpTo(jump{kind: ast.KindBreakStatement, label: clauseLabel}, node)})
}
