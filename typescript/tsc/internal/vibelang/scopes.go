package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Scope regions (design D14, D19, D25, D47; spec Chapters 6, 7, and 26).
//
// A block of an Effect function that declares using is a Scope region, and so
// is a region the source names that owns a fork (D408): a function body, an
// arrow's expression body included (D353); one iteration of a loop body; a
// try, catch, or finally block; a handle clause, which compiles like a
// function; and a provide or mask block. A block that is only braces, such as
// an if branch or a bare block, owns nothing, and neither does a do block or
// a match expression, whose code runs in the region around it, so
// `if (ready) fork work()` and `if (ready) { fork work() }` mean the same. A
// region runs under a Scope of its own, which only its using acquisitions
// and the fibers it owns receive, and which closes when the region exits by
// any path: success, failure, or interruption. Closing runs the releases and
// interrupts the owned fibers, newest first, and waits for each before going
// on:
//
//	function serve(port: number) {
//	  using server = Http.listen(port)   // Effect<Server, never, Scope>: gets the block's Scope
//	  fork heartbeat()                   // interrupted when serve exits, before the server closes
//	  return server.awaitShutdown()
//	}
//	// Effect<string, never, Http>
//
// Everything else in the region runs under the Scope its caller supplies, so
// a resource acquired without using belongs to the caller, and Scope stays
// in R (D14). `() => fork p()` means `() => { return fork p() }`, so the
// arrow's body owns the fiber and Scope leaves R. An owned fiber cannot
// outlive its region, so the value a fork gives may flow only where the
// region keeps it, and anywhere else is EK4838 (D409, fork_escape.go). A function that
// declares using is an Effect function (D54), even when it runs nothing else,
// so its using is always a Scope region; await using is EK1003, and the
// lowering treats it as using.
//
// using runs its initializer with the block's Scope, so every release an
// acquisition there registers runs when the block exits, and exactly one
// owner releases the value (D401): the acquisition, when it recorded the
// value's release (Effect.acquireRelease and Effect.acquireDisposable, as the
// runtime gives them), and otherwise using, which disposes a value with a
// disposal method once. TypeScript checks that the value is a Disposable,
// null, or undefined unless the initializer requires Scope (TS2850). using
// is one Effect program for every initializer, whatever its type (D490):
// Effect.acquireRelease(e, release, { interruptible: true }), which runs e
// with the interruptibility in force where the using stands, as yield* runs
// it, each acquisition in e keeping its own policy (D25), and adds no mask
// of its own. The block supplies Scope to the whole initializer, each
// operand it evaluates included, so a generic R in its requirements leaves
// as Exclude<R, Scope>. for (using x of values) takes each
// value with using in a Scope region around that iteration's body, so the
// value is released when the iteration ends, by any path; over an iterator,
// a producer, or a Stream, $forOf runs those iterations and closes what it
// iterates when the loop exits early, after the value. for (using x =
// value; test; step) takes its values once, as JavaScript does, in a Scope
// region around the whole loop, so they are released when the loop exits.

func init() {
	checker.RegisterUsingInitializerHook(usingInitializer)
}

// isBlockUsing reports whether node is a using statement directly in a
// block, the form a Scope region lowers. A using in a for head belongs to
// its loop (isUsingFor, isUsingForOf); one in a case clause, which
// TypeScript rejects, stays as TypeScript emits it.
func isBlockUsing(node *ast.Node) bool {
	return node.Kind == ast.KindVariableStatement && isUsingList(node.AsVariableStatement().DeclarationList) &&
		node.Parent != nil && node.Parent.Kind == ast.KindBlock
}

// isUsingFor reports whether node is `for (using x = value; test; step)
// body`, a C-style loop whose head declares using.
func isUsingFor(node *ast.Node) bool {
	if node.Kind != ast.KindForStatement {
		return false
	}
	initializer := node.AsForStatement().Initializer
	return initializer != nil && initializer.Kind == ast.KindVariableDeclarationList && isUsingList(initializer)
}

// labeledLoop returns the statement under node's labels: node itself when it
// is not a labeled statement.
func labeledLoop(node *ast.Node) *ast.Node {
	for node.Kind == ast.KindLabeledStatement {
		node = node.AsLabeledStatement().Statement
	}
	return node
}

// outermostLabel returns the outermost labeled statement whose statement,
// under its labels, is node, or node when no label names it.
func outermostLabel(node *ast.Node) *ast.Node {
	for node.Parent != nil && node.Parent.Kind == ast.KindLabeledStatement {
		node = node.Parent
	}
	return node
}

// isUsingForOf reports whether node is `for (using x of values) body`, whose
// body the lowering makes a Scope region for each iteration.
func isUsingForOf(node *ast.Node) bool {
	if node.Kind != ast.KindForOfStatement {
		return false
	}
	initializer := node.AsForInOrOfStatement().Initializer
	return initializer != nil && initializer.Kind == ast.KindVariableDeclarationList && isUsingList(initializer)
}

// ownerRegion returns the innermost region the source names around node
// (D408): a function body, an arrow's expression body included (D353), a
// loop body, a try, catch, or finally block, a handle clause, a block that
// declares using, or a provide or mask block. A do block, a match
// expression, and a catch expression's sides belong to the region around
// them. It returns nil when no region of node's function encloses it, as in
// a parameter list.
func ownerRegion(node *ast.Node) *ast.Node {
	for n := node; n.Parent != nil; n = n.Parent {
		parent := n.Parent
		if isFunctionBoundary(parent) {
			if parent.Body() != n || !ast.IsFunctionLike(parent) {
				return nil
			}
			if isRegionTransparent(parent) {
				continue
			}
			return n
		}
		if isNamedRegion(n) {
			return n
		}
	}
	return nil
}

// isNamedRegion reports whether node, which is not a function body, is a
// region that owns the forks in it (D408): a loop body, a try, catch, or
// finally block, a handle clause, a block that declares using, or a provide
// or mask block.
func isNamedRegion(node *ast.Node) bool {
	parent := node.Parent
	switch {
	case parent == nil:
		return false
	case ast.IsIterationStatement(parent, false /*lookInLabeledStatements*/):
		return parent.Statement() == node
	case parent.Kind == ast.KindTryStatement:
		try := parent.AsTryStatement()
		return try.TryBlock == node || try.FinallyBlock == node
	case parent.Kind == ast.KindCatchClause:
		return parent.AsCatchClause().Block == node && (parent.Parent == nil || !isHandleStatement(parent.Parent)) // a handle statement's catch block only holds its clauses
	case node.Kind != ast.KindBlock:
		return false
	case handleClauseOfBlock(node) != nil, isProvideBlock(node), maskWord(node) != "":
		return true
	}
	for _, statement := range node.AsBlock().Statements.Nodes {
		if isBlockUsing(statement) {
			return true
		}
	}
	return false
}

// isRegionTransparent reports whether fn, a function the parser wrote, holds
// code of the region around it, which owns its forks: a do block's function
// and a match expression's, which are called where they stand, an is test's,
// and a catch expression's sides.
func isRegionTransparent(fn *ast.Node) bool {
	if !isProgramArrow(fn) || fn.Parent == nil {
		return false
	}
	if parent := fn.Parent; ast.IsParenthesizedExpression(parent) && parent.Parent != nil && ast.IsCallExpression(parent.Parent) && parent.Parent.Expression() == parent {
		return true
	}
	return catchExpressionOf(fn.Parent) != nil
}

// usingDeclarationOf returns the declaration whose initializer is node,
// skipping parentheses, when that declaration belongs to a using statement
// directly in a block or to the head of a C-style for loop; otherwise nil.
func usingDeclarationOf(node *ast.Node) *ast.Node {
	parent := node.Parent
	for parent != nil && parent.Kind == ast.KindParenthesizedExpression {
		node, parent = parent, parent.Parent
	}
	if parent == nil || parent.Kind != ast.KindVariableDeclaration || parent.Initializer() != node {
		return nil
	}
	if list := parent.Parent; list != nil && list.Parent != nil && (isBlockUsing(list.Parent) || isUsingFor(list.Parent)) {
		return parent
	}
	return nil
}

// usingInitializerOf returns the using declaration, in a block or a for head,
// whose initializer holds node in its own code: node is the initializer, or
// an operand the initializer evaluates where it stands, such as a branch of
// a conditional, an operand of a comma, or an argument, and not code in a
// function or class nested in it. Otherwise it returns nil.
func usingInitializerOf(node *ast.Node) *ast.Node {
	for n := node; n.Parent != nil; n = n.Parent {
		parent := n.Parent
		switch {
		case parent.Kind == ast.KindVariableDeclaration:
			if parent.Initializer() != n {
				return nil
			}
			return usingDeclarationOf(n)
		case isFunctionBoundary(parent), ast.IsStatement(parent), parent.Kind == ast.KindBlock:
			return nil
		}
	}
	return nil
}

// isAcquisition reports whether call is an acquisition: a call that runs an
// Effect in the initializer of a using declaration in a block or a for head,
// the initializer itself or an operand it evaluates (usingInitializerOf).
// using runs its whole initializer with the block's Scope, so Scope leaves
// the R of each acquisition in it (D401, D490).
func (a *analyzer) isAcquisition(call *ast.Node) bool {
	return usingInitializerOf(call) != nil && a.runs(call)
}

// requiresScope reports whether initializer, a using declaration's, requires
// Scope: Scope is a member of the R of a call it runs, the initializer or an
// operand it evaluates, with a type parameter there read by its constraint
// (isScopeRequirement, D490). Then using may bind a value it cannot dispose,
// which an acquisition releases (D401). Scope never decides who releases a
// value using can dispose, which the run-time record does, or how the
// initializer runs, which is the same for every initializer (D490).
func (a *analyzer) requiresScope(initializer *ast.Node) bool {
	if usingDeclarationOf(initializer) == nil {
		return false
	}
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isFunctionBoundary(n), n != initializer && a.isByName(n), isHatchArgument(n):
			return false // nothing there runs as part of the initializer, or its callee's R holds what it needs
		case n.Kind == ast.KindCallExpression && a.isAcquisition(n):
			acquisition := &effectInfo{}
			a.addCall(acquisition, n)
			for _, r := range acquisition.requirements {
				if slices.ContainsFunc(unionMembers(r), a.isScopeRequirement) {
					found = true
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	visit(initializer)
	return found
}

// isScopeRequirement reports whether t, a member of a requirements union, is
// effect's Scope, reading a generic member, such as a type parameter R, by
// its constraint: R extends Scope is Scope, and so is a constraint that has
// Scope as a member. An unconstrained R, any, and unknown are not (D490).
func (a *analyzer) isScopeRequirement(t *checker.Type) bool {
	if isScopeType(t) {
		return true
	}
	if t.Flags()&checker.TypeFlagsInstantiable == 0 {
		return false
	}
	constraint := a.checker.GetBaseConstraintOfType(t)
	if constraint == nil || constraint == t || constraint.Flags()&checker.TypeFlagsAnyOrUnknown != 0 {
		return false
	}
	return slices.ContainsFunc(unionMembers(constraint), isScopeType)
}

// usingInitializer is the checker's using initializer hook. In a .vibe
// body, using releases an AsyncDisposable too, and an initializer that
// requires Scope may give a value using cannot dispose, which its
// acquisition releases (D401). Whether it does depends on contracts that may
// still be in inference while TypeScript checks the declaration, so
// TypeScript's own check is skipped there, and checkUsingInitializers checks
// the value once the file is checked.
func usingInitializer(c *checker.Checker, declaration *ast.Node) bool {
	initializer := declaration.Initializer()
	if initializer == nil || !isVibeLangFile(ast.GetSourceFileOfNode(declaration)) {
		return false
	}
	return inLowerableBody(initializer) && usingDeclarationOf(initializer) != nil
}

func init() { fileChecks = append(fileChecks, checkUsingInitializers) }

// checkUsingInitializers checks each using declaration whose TypeScript
// check usingInitializer skipped: unless its initializer requires Scope, its
// value must be a Disposable, an AsyncDisposable, null, or undefined, as
// TypeScript's TS2850 requires (D401).
func checkUsingInitializers(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration {
			if initializer := node.Initializer(); initializer != nil && usingInitializer(c, node) && !a.requiresScope(ast.SkipParentheses(initializer)) {
				c.CheckUsingDisposable(node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// forkOwner returns the region whose Scope owns the fiber that call starts,
// or nil (ownerRegion). call must be a call to the prelude's fork that runs,
// which is fork(program), in the body of a function the lowering can turn
// into an Effect.
func (a *analyzer) forkOwner(call *ast.Node) *ast.Node {
	if !a.isPreludeFork(call) || !inLowerableBody(call) || !a.runs(call) {
		return nil
	}
	return ownerRegion(call)
}

// isPreludeFork reports whether call calls the runtime's fork: the prelude's,
// or one imported from vibelang-runtime.
func (a *analyzer) isPreludeFork(call *ast.Node) bool {
	return isRuntimeExport(a.checker, ast.SkipParentheses(call.Expression()), "fork")
}

// getsScope reports whether call runs with the Scope of a Scope region: it
// forks a fiber the region owns, or it is a using acquisition.
func (a *analyzer) getsScope(call *ast.Node) bool {
	return a.forkOwner(call) != nil || a.isAcquisition(call)
}

// addScoped adds to info what call, which getsScope, adds to E and R. A fork
// adds the requirements of the program it starts, whose fiber sees this
// fiber's services, and none of its failures, which reach the parent only
// through Fiber.join. An acquisition adds its failures and its requirements
// other than Scope, plus the service its callee looks up.
func (a *analyzer) addScoped(info *effectInfo, call *ast.Node) {
	c := a.checker
	if a.forkOwner(call) != nil {
		if arguments := call.Arguments(); len(arguments) > 0 {
			program := c.GetTypeAtLocation(arguments[0])
			if operand := ast.SkipParentheses(arguments[0]); a.keywordOperand(operand) {
				// A keyword operand's own type is its value's; its program's
				// R is what running it needs (D322).
				program = a.keywordProgramType(operand, a.keywordValueType(operand))
			}
			if r := channelType(c, program, "_R"); r != nil {
				info.addRequirement(r, call)
				if info.effect == nil {
					info.effect = effectInterface(c, program)
				}
				return
			}
		}
		forked := &effectInfo{}
		a.addCall(forked, call)
		forked = a.withoutScope(forked, nil /*scope*/)
		info.addRequirements(forked)
		if info.effect == nil {
			info.effect = forked.effect
		}
		return
	}
	a.addServiceLookup(info, call)
	acquisition := &effectInfo{}
	a.addCall(acquisition, call)
	info.add(a.withoutScope(acquisition, a.programScope()))
}

// withoutScope returns info without effect's Scope among its requirements,
// splitting unions and keeping each requirement's source: a Scope region
// supplies the Scope that its acquisitions and forks ask for. Given scope,
// effect's Scope type, a generic member, such as a type parameter R, keeps
// what the region does not supply, Exclude<R, Scope>, as $using's own type
// and Effect.scoped leave it: a using supplies Scope to its whole
// initializer, a contract-less callback's channel included (D68, D490). A
// fork passes nil, since forkIn supplies no Scope to the program it starts,
// and its generic members stay as they are.
func (a *analyzer) withoutScope(info *effectInfo, scope *checker.Type) *effectInfo {
	out := &effectInfo{effect: info.effect}
	out.addErrors(info)
	for i, r := range info.requirements {
		var source *ast.Node
		if i < len(info.requirementSources) {
			source = info.requirementSources[i]
		}
		members := []*checker.Type{r}
		if r.Flags()&checker.TypeFlagsUnion != 0 {
			members = r.Types()
		}
		for _, member := range members {
			switch {
			case isScopeType(member):
			case scope != nil && member.Flags()&checker.TypeFlagsInstantiable != 0:
				out.addRequirement(a.checker.ExcludeType(member, scope), source)
			default:
				out.addRequirement(member, source)
			}
		}
	}
	return out
}

// programScope returns effect's Scope interface, from the Scope module among
// the program's files, or nil when the program does not include it. Like
// programEffectInterface, it does not depend on the order in which the
// checker checks things.
func (a *analyzer) programScope() *checker.Type {
	if a.programScopeSearched {
		return a.programScopeType
	}
	a.programScopeSearched = true
	for _, file := range a.checker.Program().SourceFiles() {
		if !isEffectModuleFile(file, "Scope") || file.Symbol == nil {
			continue
		}
		for _, export := range a.checker.GetExportsOfModule(file.Symbol) {
			if export.Name() == "Scope" && export.Flags()&ast.SymbolFlagsInterface != 0 {
				a.programScopeType = a.checker.GetDeclaredTypeOfSymbol(export)
				return a.programScopeType
			}
		}
	}
	return nil
}

// isScopeType reports whether t is effect's Scope.Scope.
func isScopeType(t *checker.Type) bool {
	symbol := t.Symbol()
	if symbol == nil || symbol.Name() != "Scope" || symbol.Flags()&ast.SymbolFlagsInterface == 0 {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		if isEffectModuleFile(ast.GetSourceFileOfNode(declaration), "Scope") {
			return true
		}
	}
	return false
}
