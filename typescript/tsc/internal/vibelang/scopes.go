package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A block with using owns a resource Scope, closed on every exit path.
// Plain keyword fork instead belongs to the current fiber (VIP-17), so no
// resource region is introduced for it and a helper's return does not end its
// child's lifetime.
//
// A using declaration supplies its region's Scope to the whole initializer.
// Other programs keep the Scope their caller supplies.
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
		case isFunctionBoundary(n), n != initializer && false, isHatchArgument(n):
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

// nativeFork reports a source keyword operation, whose owner is the current
// fiber (VIP-17), independently of lexical resource Scope regions.
func isNativeFork(call *ast.Node) bool {
	return isKeywordFormCall(call) && len(call.Arguments()) == 1 && ast.SkipParentheses(call.Expression()).Text() == "fork"
}

// isPreludeFork reports whether call calls the runtime's fork: the prelude's,
// or one imported from vibelang-runtime.
func (a *analyzer) isPreludeFork(call *ast.Node) bool {
	return isRuntimeExport(a.checker, ast.SkipParentheses(call.Expression()), "fork")
}

// getsScope reports whether call is an acquisition supplied with its using
// region's resource Scope.
func (a *analyzer) getsScope(call *ast.Node) bool {
	return a.isAcquisition(call)
}

// addScoped adds an acquisition's failures and requirements other than Scope,
// plus the service its callee looks up.
func (a *analyzer) addScoped(info *effectInfo, call *ast.Node) {
	a.addServiceLookup(info, call)
	acquisition := &effectInfo{}
	a.addCall(acquisition, call)
	info.add(a.withoutScope(acquisition, a.programScope()))
}

// withoutScope returns info without effect's Scope among its requirements,
// splitting unions and keeping each requirement's source: a Scope region
// supplies the Scope that its acquisitions ask for. Given scope,
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

// declaresUsing reports whether fn's own body declares a using variable,
// which acquires an Effect resource, so fn compiles to frames (D54).
func declaresUsing(fn *ast.Node) bool {
	return firstUsing(fn) != nil
}

// firstUsing returns the first using declaration list in fn's own body, or
// nil.
func firstUsing(fn *ast.Node) *ast.Node {
	var found *ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindVariableDeclarationList && isUsingList(n) {
			found = n
			return true
		}
		return n.ForEachChild(visit)
	}
	visit(fn.Body())
	return found
}

// isUsingList reports whether list, a variable declaration list, declares
// using or await using variables. The block-scoped flags of await using are
// those of const and using together, so a test for either flag alone would
// match const.
func isUsingList(list *ast.Node) bool {
	kind := list.Flags & ast.NodeFlagsBlockScoped
	return kind == ast.NodeFlagsUsing || kind == ast.NodeFlagsAwaitUsing
}

// addFork contributes the program's requirements and no errors of its child.
// The Fiber carries those errors until joined; forking itself needs no Scope.
func (a *analyzer) addFork(info *effectInfo, call *ast.Node) {
	c := a.checker
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
