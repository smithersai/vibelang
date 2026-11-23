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
