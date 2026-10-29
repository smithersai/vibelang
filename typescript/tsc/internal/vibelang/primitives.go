package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// The primitives of a .vibe file that have their own syntax (D176-D180).
//
//	try { load() } catch (e: NotFound) { … } catch (cause: Cause) { log(cause); throw cause }
//	try { serve() } finally (exit) { Console.log(exit._tag) }
//	uninterruptible { const conn = acquire(); try { restore { use(conn) } } finally { release(conn) } }
//	interruptible { poll() }
//
// A catch clause typed Cause catches every reason (Effect.catchCause); the
// parser makes the catch variable $cause, which the checker types
// Cause<E>, and the lowering runs the try block under the runtime's
// $catchCause. `throw` fails with its operand whatever its type, a Cause
// object included (VIP-4); `Effect.failCause(cause)` fails with every reason
// a cause holds. `finally (exit)` binds `const exit = $exit()`, which the
// checker types as the try statement's Exit and the lowering turns into the
// parameter of the finally closure under $finallyExit (Effect.onExit). An
// interruption block is a block whose first statement calls a marker, such as
// $uninterruptibleBlock(); the lowering runs the rest as a region under the
// prelude's uninterruptible, restore, or interruptible, the functions that
// `uninterruptible(program)` also calls. interrupt(), exit(program), and
// yieldNow() are bare functions (effectroot.go, the runtime's primitives).

func init() {
	registry[EK2111.Code] = EK2111
	fileChecks = append(fileChecks, checkPrimitives)
	ls.RegisterQuickInfoHook(primitiveQuickInfo)
}

// maskWord returns "uninterruptible", "restore", or "interruptible" when node
// is an interruption block, and "" otherwise.
func maskWord(node *ast.Node) string {
	if node.Kind != ast.KindBlock {
		return ""
	}
	statements := node.AsBlock().Statements.Nodes
	if len(statements) == 0 {
		return ""
	}
	return maskMarkerWord(statements[0])
}

// maskMarkerWord returns the word of the marker statement the parser writes
// first in an interruption block, or "".
func maskMarkerWord(statement *ast.Node) string {
	if statement.Kind != ast.KindExpressionStatement {
		return ""
	}
	call := statement.Expression()
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 0 {
		return ""
	}
	callee := call.Expression()
	if callee.Kind != ast.KindIdentifier || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return ""
	}
	switch callee.Text() {
	case "$uninterruptibleBlock":
		return "uninterruptible"
	case "$restoreBlock":
		return "restore"
	case "$interruptibleBlock":
		return "interruptible"
	}
	return ""
}

// isRemovedPrimitiveMarker reports whether node is a name the parser writes
// for the checker and the lowering removes, so the emitted code never imports
// it: $exit and the interruption blocks' markers.
func isRemovedPrimitiveMarker(node *ast.Node) bool {
	if node.Kind != ast.KindIdentifier || node.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	switch node.Text() {
	case "$exit", "$uninterruptibleBlock", "$restoreBlock", "$interruptibleBlock":
		return true
	}
	return false
}

// isExitMarkerCall reports whether node is the $exit() that `finally (exit)`
// binds.
func isExitMarkerCall(node *ast.Node) bool {
	if !ast.IsCallExpression(node) || len(node.Arguments()) != 0 {
		return false
	}
	callee := node.Expression()
	return callee.Kind == ast.KindIdentifier && callee.Flags&ast.NodeFlagsReparsed != 0 && callee.Text() == "$exit"
}

// exitBinding returns the declaration of `finally (exit)`'s binding when
// block, a finally block, has one, and nil otherwise.
func exitBinding(block *ast.Node) *ast.Node {
	if block == nil {
		return nil
	}
	statements := block.AsBlock().Statements.Nodes
	if len(statements) == 0 {
		return nil
	}
	return exitBindingOf(statements[0])
}

// exitBindingOf returns the declaration statement holds when it is
// `const exit = $exit()`, and nil otherwise.
func exitBindingOf(statement *ast.Node) *ast.Node {
	if statement.Kind != ast.KindVariableStatement {
		return nil
	}
	declarations := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 || declarations[0].Initializer() == nil || !isExitMarkerCall(declarations[0].Initializer()) {
		return nil
	}
	return declarations[0]
}

// isCauseCatch reports whether try, a try statement, has a catch clause with a
// clause typed Cause: its variable is the $cause the parser writes.
func isCauseCatch(try *ast.Node) bool {
	clause := try.AsTryStatement().CatchClause
	if clause == nil || isHandleStatement(try) {
		return false
	}
	variable := clause.AsCatchClause().VariableDeclaration
	return variable != nil && isCauseVariable(variable)
}

// isCauseVariable reports whether declaration is the $cause catch variable.
func isCauseVariable(declaration *ast.Node) bool {
	name := declaration.Name()
	return name != nil && name.Kind == ast.KindIdentifier && name.Flags&ast.NodeFlagsReparsed != 0 && name.Text() == "$cause"
}

// hasPrimitiveStatement reports whether fn's own body has an interruption
// block, a catch clause typed Cause, or `finally (exit)`, which make it an
// Effect.
func hasPrimitiveStatement(fn *ast.Node) bool {
	if fn.Body() == nil {
		return false
	}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if maskWord(n) != "" {
			return true
		}
		if n.Kind == ast.KindTryStatement && (isCauseCatch(n) || exitBinding(n.AsTryStatement().FinallyBlock) != nil) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(fn.Body())
}

// primitiveTypes is what one checker remembers about effect's Cause interface.
type primitiveTypes struct {
	cause         *checker.Type
	causeSearched bool
}

type primitiveTypesKey struct{}

func primitivesOf(c *checker.Checker) *primitiveTypes {
	return c.ExtensionState(primitiveTypesKey{}, func() any { return &primitiveTypes{} }).(*primitiveTypes)
}

// causeInterface returns the generic Cause interface that effect's Cause
// module declares, or nil when the program does not include it.
func causeInterface(c *checker.Checker) *checker.Type {
	s := primitivesOf(c)
	if s.causeSearched {
		return s.cause
	}
	s.causeSearched = true
	for _, file := range c.Program().SourceFiles() {
		if !isEffectModuleFile(file, "Cause") || file.Symbol == nil {
			continue
		}
		for _, export := range c.GetExportsOfModule(file.Symbol) {
			if export.Name() == "Cause" && export.Flags()&ast.SymbolFlagsInterface != 0 {
				s.cause = c.GetDeclaredTypeOfSymbol(export)
				return s.cause
			}
		}
	}
	return nil
}

// causeVariableType types $cause, the variable of a catch clause typed
// Cause: the Cause of the try block's expected failures.
func causeVariableType(c *checker.Checker, declaration *ast.Node) *checker.Type {
	if !isCauseVariable(declaration) {
		return nil
	}
	clause := declaration.Parent
	if clause == nil || clause.Kind != ast.KindCatchClause || !inLowerableBody(clause.Parent) {
		return nil
	}
	target := causeInterface(c)
	if target == nil {
		return nil
	}
	info := analyzerFor(c).tryBlockFlow(clause.Parent.AsTryStatement().TryBlock)
	return c.NewTypeReference(target, []*checker.Type{c.GetUnionType(info.errors)})
}

// exitCallType types `$exit()`, what `finally (exit)` binds, as the Exit of
// its try statement, Exit<void, E>, where E is what can escape the try block,
// or the catch block when there is one. t is the declared Exit<void,
// unknown>; each of its members, Success and Failure, is instantiated with E.
func exitCallType(c *checker.Checker, call *ast.Node, t *checker.Type) *checker.Type {
	try := enclosingTryOfFinally(call)
	if try == nil {
		return t
	}
	statement := try.AsTryStatement()
	var info *effectInfo
	if catches(try) {
		info = analyzerFor(c).flowOf(statement.CatchClause.AsCatchClause().Block)
	} else {
		info = analyzerFor(c).tryBlockFlow(statement.TryBlock)
	}
	errors := c.GetUnionType(info.errors)
	var members []*checker.Type
	for _, member := range unionMembers(t) {
		if member.Flags()&checker.TypeFlagsObject == 0 || member.ObjectFlags()&checker.ObjectFlagsReference == 0 {
			return t
		}
		members = append(members, c.NewTypeReference(member.Target(), []*checker.Type{c.GetVoidType(), errors}))
	}
	return c.GetUnionType(members)
}

// enclosingTryOfFinally returns the try statement whose finally block binds
// call, a $exit() call, or nil.
func enclosingTryOfFinally(call *ast.Node) *ast.Node {
	declaration := call.Parent
	if declaration == nil || declaration.Kind != ast.KindVariableDeclaration {
		return nil
	}
	statement := declaration.Parent
	if statement != nil {
		statement = statement.Parent
	}
	if statement == nil || statement.Kind != ast.KindVariableStatement {
		return nil
	}
	block := statement.Parent
	if block == nil || block.Kind != ast.KindBlock {
		return nil
	}
	try := block.Parent
	if try == nil || try.Kind != ast.KindTryStatement || try.AsTryStatement().FinallyBlock != block {
		return nil
	}
	return try
}

// checkPrimitives reports EK1001 at an interruption block at a module's top
// level, which would run a program, and EK2111 at a restore block that no
// uninterruptible block of the same function encloses.
func checkPrimitives(c *checker.Checker, file *ast.SourceFile) {
	var visit func(n *ast.Node, inFunction bool, masked bool) bool
	visit = func(n *ast.Node, inFunction bool, masked bool) bool {
		if isFunctionBoundary(n) {
			// The program of uninterruptible written as an expression, as in
			// `return uninterruptible { … }`, runs masked like the statement form.
			inner := isUninterruptibleProgram(c, n)
			n.ForEachChild(func(child *ast.Node) bool { return visit(child, true, inner) })
			return false
		}
		switch maskWord(n) {
		case "":
		case "restore":
			marker := n.AsBlock().Statements.Nodes[0]
			if !inFunction {
				note(report(c, marker, EK1001.With("This restore block runs a program, but a module's top level is not inside one.")), topLevelBlockNote)
			} else if !masked {
				note(report(c, marker, EK2111), "Put it inside an uninterruptible block, or use interruptible { … } to make the code interruptible.")
			}
		case "uninterruptible":
			if !inFunction {
				note(report(c, n.AsBlock().Statements.Nodes[0], EK1001.With("This uninterruptible block runs a program, but a module's top level is not inside one.")), topLevelBlockNote)
			}
			n.ForEachChild(func(child *ast.Node) bool { return visit(child, inFunction, true) })
			return false
		case "interruptible":
			if !inFunction {
				note(report(c, n.AsBlock().Statements.Nodes[0], EK1001.With("This interruptible block runs a program, but a module's top level is not inside one.")), topLevelBlockNote)
			}
		}
		n.ForEachChild(func(child *ast.Node) bool { return visit(child, inFunction, masked) })
		return false
	}
	file.AsNode().ForEachChild(func(child *ast.Node) bool { return visit(child, false, false) })
}

// isUninterruptibleProgram reports whether fn is the program a call of the
// runtime's uninterruptible runs: its block param, as in
// `return uninterruptible { … }`, or an arrow passed to it.
func isUninterruptibleProgram(c *checker.Checker, fn *ast.Node) bool {
	call := fn.Parent
	if call == nil || !ast.IsCallExpression(call) {
		return false
	}
	arguments := call.Arguments()
	if len(arguments) != 1 || arguments[0] != fn {
		return false
	}
	return isRuntimeExport(c, ast.SkipParentheses(call.Expression()), "uninterruptible")
}

// primitiveQuickInfo describes an interruption block's word.
func primitiveQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	if node == nil || node.Kind != ast.KindIdentifier || node.Flags&ast.NodeFlagsReparsed == 0 || node.Parent == nil || node.Parent.Parent == nil {
		return "", ""
	}
	switch maskMarkerWord(node.Parent.Parent) {
	case "uninterruptible":
		return "uninterruptible", "Runs the block without interruption, as Effect.uninterruptibleMask. A restore block inside it brings back the interruptibility the fiber had before."
	case "restore":
		return "restore", "Runs the block with the interruptibility the enclosing uninterruptible block began with, as uninterruptibleMask's restore."
	case "interruptible":
		return "interruptible", "Runs the block so it can be interrupted, as Effect.interruptible."
	}
	return "", ""
}

// visitMaskBlock lowers node, an interruption block, to a region closure that
// runs under the prelude's uninterruptible, restore, or interruptible.
func (tx *lowering) visitMaskBlock(node *ast.Node, word string) *ast.Node {
	f := tx.Factory()
	r := &region{}
	statements := tx.regionStatements(r, node)
	run := tx.runNow(tx.regionFunction(r, word, nil, node, statements), node)
	run = f.NewCallExpression(tx.runtimeMember(word), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{run}), ast.NodeFlagsNone)
	return tx.runRegion(node, run, r)
}
