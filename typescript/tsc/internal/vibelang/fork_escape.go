package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A fiber stays with its owner (D353, D386, D409; spec Chapter 7). A fork
// belongs to the innermost region the source names around it (D408,
// ownerRegion in scopes.go), which interrupts the fiber when it exits. The
// fiber is therefore interrupted by the time anything outside the region
// could use it, so the value a fork gives may go only to these places:
//
//   - a const or let declared in the region, and reads of it there;
//   - the operand of join, and an element of an array or object literal
//     written as that operand or held in a const or let of the region whose
//     every read is such an operand (D225). A getter of such a literal is
//     still a function literal, so a fiber it returns is captured;
//   - an argument of the prelude's interrupt, or of a function of effect's
//     Fiber module whose result type holds no Fiber, and the methods those
//     functions give a fiber (D152), such as pending.interrupt();
//   - the operand of a fork, an element of an await operation, or the body
//     of a for concurrent loop written in the region, which finish before
//     the region does.
//
// It may also be discarded, as `fork heartbeat()` alone discards it, and it
// passes through parentheses, type assertions, conditionals, logical
// operators, and the value of a do block, a match expression, or a catch
// expression, which run where they stand. Anywhere else is EK4838, an error
// that no setting lowers:
//
//	function startHeartbeat() { return fork heartbeat() }            // returned
//	const concise = () => fork heartbeat()                            // returned: the body is a region
//	function keep(monitor: Monitor) { monitor.fiber = fork beat() }    // assigned outside the region
//	function track(fiber: Fiber<void>) { registry.add(fork beat()) }   // passed to another call
//	function stopper() { const f = fork beat(); return () => f }       // captured by a function
//
// Effect.forkScoped, forkIn, and detach give a fiber a longer lifetime.

// EK4838: a fiber its region owns goes where it can outlive the region (D409).
// {0} names the region, {1} says where the fiber goes.
var EK4838 = message(4838, errorCategory, "This fiber is owned by {0}, which interrupts it on exit, but it is {1}.")

func init() {
	registry[EK4838.Code] = EK4838
	fileChecks = append(fileChecks, checkFiberFlows)
	ls.RegisterCodeFixProvider(escapingFiberFix)
}

func checkFiberFlows(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			if region := a.forkOwner(node); region != nil {
				flow := &fiberFlow{c: c, a: a, file: file, fork: node, region: region, bindings: map[*ast.Symbol]bool{}}
				if out := flow.check(); out != nil {
					flow.report(out)
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// A fiberFlow follows the value of one owned fork through its region.
type fiberFlow struct {
	c        *checker.Checker
	a        *analyzer
	file     *ast.SourceFile
	fork     *ast.Node // the fork call
	region   *ast.Node // the region that owns its fiber
	bindings map[*ast.Symbol]bool
}

// A fiberEscape is where the fiber goes that it may not: at, a node of the
// region, and how, the message's account of it.
type fiberEscape struct {
	at       *ast.Node
	how      string
	captured bool // by a function or a call, where racing the join instead may help
}

// check returns the first place, in source order, where the fork's value
// goes that it may not, or nil.
func (f *fiberFlow) check() *fiberEscape {
	var first *fiberEscape
	consider := func(out *fiberEscape) {
		if out != nil && (first == nil || out.at.Pos() < first.at.Pos()) {
			first = out
		}
	}
	consider(f.use(f.fork))
	scanned := map[*ast.Symbol]bool{}
	for {
		var pending []*ast.Symbol
		for symbol := range f.bindings {
			if !scanned[symbol] {
				pending = append(pending, symbol)
				scanned[symbol] = true
			}
		}
		if len(pending) == 0 {
			return first
		}
		for _, read := range f.reads(pending) {
			consider(f.use(read))
		}
	}
}

// reads returns the reads of symbols in the region: identifiers that refer
// to one, and shorthand properties that do, but not their declarations, the
// targets of assignments to them, or type queries.
func (f *fiberFlow) reads(symbols []*ast.Symbol) []*ast.Node {
	wanted := map[*ast.Symbol]bool{}
	for _, symbol := range symbols {
		wanted[symbol] = true
	}
	var reads []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case ast.IsShorthandPropertyAssignment(n):
			if wanted[f.c.GetShorthandAssignmentValueSymbol(n)] {
				reads = append(reads, n.Name())
			}
			return false
		case ast.IsIdentifier(n):
			parent := n.Parent
			switch {
			case ast.IsPartOfTypeNode(n):
			case parent != nil && ast.IsVariableDeclaration(parent) && parent.Name() == n:
			case parent != nil && ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken && ast.SkipParentheses(parent.AsBinaryExpression().Left) == n:
			default:
				if wanted[f.c.GetSymbolAtLocation(n)] {
					reads = append(reads, n)
				}
			}
			return false
		}
		return n.ForEachChild(visit)
	}
	visit(f.region)
	return reads
}

// use returns where value, the fork or a read of a binding that holds its
// fiber, goes that it may not, or nil. A function that refers to it captures
// it, unless the parser wrote it for a fork block or a for concurrent body.
func (f *fiberFlow) use(value *ast.Node) *fiberEscape {
	for n := value; n != f.region && n.Parent != nil; n = n.Parent {
		if isFunctionBoundary(n) && n != value && !isRegionTransparent(n) && !(isProgramArrow(n) && f.inRegionCall(n)) {
			if isProgramArrow(n) && n.Body() != nil && ast.IsBlock(n.Body()) {
				return &fiberEscape{at: value, how: "captured by a block param", captured: true}
			}
			return &fiberEscape{at: value, how: "captured by a function", captured: true}
		}
	}
	return f.flow(value)
}

// inRegionCall reports whether n is the direct operand of a fork or an
// await operation, or the body of a for concurrent loop, each of which
// finishes before the region does.
func (f *fiberFlow) inRegionCall(n *ast.Node) bool {
	call := n.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() == n {
		return false
	}
	arguments := call.Arguments()
	switch fiberHelper(call) {
	case "$awaitAll", "$awaitAllSettled", "$awaitRace", "$awaitAny":
		return true
	case "$forConcurrent":
		return len(arguments) == 3 && arguments[2] == n
	}
	return len(arguments) > 0 && arguments[0] == n && f.a.isPreludeFork(call)
}

// flow follows value outward through the expressions that pass it on, and
// returns where it goes that it may not, or nil.
func (f *fiberFlow) flow(value *ast.Node) *fiberEscape {
	n := value
	for {
		if n == f.region {
			return &fiberEscape{at: n, how: "returned from that " + f.noun()} // an arrow's expression body
		}
		if f.inRegionCall(n) {
			return nil
		}
		parent := n.Parent
		if parent == nil {
			return f.elsewhere(n)
		}
		switch {
		case ast.IsParenthesizedExpression(parent), ast.IsAsExpression(parent), ast.IsSatisfiesExpression(parent), ast.IsNonNullExpression(parent), parent.Kind == ast.KindTypeAssertionExpression:
			n = parent
			continue
		case ast.IsConditionalExpression(parent):
			if parent.AsConditionalExpression().Condition == n {
				return f.elsewhere(n)
			}
			n = parent
			continue
		case ast.IsBinaryExpression(parent):
			binary := parent.AsBinaryExpression()
			switch op := binary.OperatorToken.Kind; {
			case op == ast.KindCommaToken && binary.Left == n:
				return nil // discarded
			case op == ast.KindCommaToken, op == ast.KindBarBarToken, op == ast.KindAmpersandAmpersandToken, op == ast.KindQuestionQuestionToken:
				n = parent
				continue
			case binary.Right == n && (op == ast.KindEqualsToken || op == ast.KindBarBarEqualsToken || op == ast.KindAmpersandAmpersandEqualsToken || op == ast.KindQuestionQuestionEqualsToken):
				target := ast.SkipParentheses(binary.Left)
				if !ast.IsIdentifier(target) || !f.bind(f.c.GetSymbolAtLocation(target)) {
					return &fiberEscape{at: n, how: "assigned to " + messageText(target, "a target") + ", which outlives that " + f.noun()}
				}
				n = parent
				continue
			}
			return f.elsewhere(n)
		case ast.IsVariableDeclaration(parent) && parent.Initializer() == n:
			name := parent.Name()
			if ast.IsIdentifier(name) && ast.GetCombinedNodeFlags(parent)&ast.NodeFlagsBlockScoped == 0 {
				return &fiberEscape{at: n, how: "held in var " + name.Text() + ", where only a const or let of that " + f.noun() + " may hold it"}
			}
			if !ast.IsIdentifier(name) || !f.bind(f.c.GetSymbolOfDeclaration(parent)) {
				return f.elsewhere(n)
			}
			return nil
		case ast.IsCallExpression(parent):
			if parent.Expression() == n {
				return f.elsewhere(n)
			}
			if f.keepsInRegion(parent) {
				return nil
			}
			return &fiberEscape{at: n, how: "passed to " + messageText(parent.Expression(), "a call") + ", which may keep it", captured: true}
		case ast.IsPropertyAccessExpression(parent) && parent.Expression() == n:
			if call := parent.Parent; call != nil && ast.IsCallExpression(call) && call.Expression() == parent && methodModuleOf(f.c, parent) == "Fiber" && !f.resultHoldsFiber(call) {
				return nil // a Fiber function as a method, such as fiber.interrupt() (D152)
			}
			return f.elsewhere(n)
		case ast.IsSpreadElement(parent), ast.IsArrayLiteralExpression(parent):
			return f.collection(parent, "an array")
		case ast.IsPropertyAssignment(parent) && parent.Initializer() == n, ast.IsShorthandPropertyAssignment(parent):
			return f.collection(parent.Parent, "an object")
		case ast.IsReturnStatement(parent):
			if fn := enclosingFunction(parent); fn != nil && isRegionTransparent(fn) {
				n = transparentValue(fn) // a do block's or a match expression's value
				continue
			}
			return &fiberEscape{at: n, how: "returned from that " + f.noun()}
		case parent.Kind == ast.KindArrowFunction && parent.Body() == n && isRegionTransparent(parent):
			n = transparentValue(parent) // a catch expression's side
			continue
		case ast.IsExpressionStatement(parent), parent.Kind == ast.KindVoidExpression:
			return nil // discarded
		}
		return f.elsewhere(n)
	}
}

// collection returns where value goes when it is an element of literal, an
// array or object literal: nowhere when the literal stays in the region
// (literalStays), the literal's return when it is returned, and otherwise
// the literal itself.
func (f *fiberFlow) collection(literal *ast.Node, kind string) *fiberEscape {
	if ast.IsSpreadElement(literal) {
		literal = literal.Parent
	}
	outer := literal
	for outer.Parent != nil && ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if f.literalStays(literal) {
		return nil
	}
	if parent := outer.Parent; parent != nil && (ast.IsReturnStatement(parent) && !isRegionTransparent(enclosingFunction(parent)) || outer == f.region) {
		return &fiberEscape{at: literal, how: "returned from that " + f.noun() + " in " + kind}
	}
	return &fiberEscape{at: literal, how: "stored in " + kind}
}

// literalStays reports whether literal, an array or object literal that holds
// an owned fiber, stays in the region with it: it is a concurrent operand,
// the operand of join or an argument of a Fiber function whose result holds
// no Fiber, or a const or let of the region holds it and every read of that
// binding, of which there is at least one, is such an operand
// (fibers-join-record). A literal held and never read that way, as in
// `const all = [fiber]; all.length`, is
// stored in a collection.
func (f *fiberFlow) literalStays(literal *ast.Node) bool {
	outer := literal
	for outer.Parent != nil && ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if f.joinsOperand(outer) || f.inRegionCall(outer) {
		return true
	}
	declaration := outer.Parent
	if declaration == nil || !ast.IsVariableDeclaration(declaration) || declaration.Initializer() != outer {
		return false
	}
	symbol := f.c.GetSymbolOfDeclaration(declaration)
	if !f.inRegion(symbol) {
		return false
	}
	reads := f.reads([]*ast.Symbol{symbol})
	for _, read := range reads {
		if !f.joinsOperand(read) {
			return false
		}
	}
	return len(reads) > 0
}

// joinsOperand reports whether n, skipping parentheses, is the operand of
// join, join x or join(x), or an argument of a Fiber function whose result
// holds no Fiber.
func (f *fiberFlow) joinsOperand(n *ast.Node) bool {
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	call := n.Parent
	return call != nil && ast.IsCallExpression(call) && call.Expression() != n && (f.isJoin(call) || f.isFiberFunction(call))
}

// isJoin reports whether call is a join: the keyword join x, or a call of
// the prelude's join, join(x) (D391). A renamed or namespace reference to
// the prelude's join is EK4410, which stands alone.
func (f *fiberFlow) isJoin(call *ast.Node) bool {
	return fiberHelper(call) == "$join" || runtimeExportOf(f.c, call.Expression()) == "join"
}

// elsewhere is the escape of a value used in any way the rule does not list.
func (f *fiberFlow) elsewhere(n *ast.Node) *fiberEscape {
	return &fiberEscape{at: n, how: "used where an owned fiber may not go"}
}

// keepsInRegion reports whether call, which receives the fiber as an
// argument, keeps it in the region: join, the prelude's interrupt, and a
// function of effect's Fiber module whose result type holds no Fiber. A
// plain await of the fiber is EK4609, whose fix writes join, so it reports
// nothing more here.
func (f *fiberFlow) keepsInRegion(call *ast.Node) bool {
	if f.isJoin(call) || fiberHelper(call) == "$await" {
		return true
	}
	return isRuntimeExport(f.c, call.Expression(), "interrupt") || f.isFiberFunction(call)
}

// isFiberFunction reports whether call calls a function of effect's Fiber
// module whose result type holds no Fiber, such as Fiber.await or
// Fiber.interruptAll.
func (f *fiberFlow) isFiberFunction(call *ast.Node) bool {
	module, _ := effectFunctionOf(f.c, call.Expression())
	return module == "Fiber" && !f.resultHoldsFiber(call)
}

// resultHoldsFiber reports whether call's result type holds a Fiber.
func (f *fiberFlow) resultHoldsFiber(call *ast.Node) bool {
	signature := f.c.GetResolvedSignature(call)
	return signature == nil || holdsFiber(f.c, f.c.GetReturnTypeOfSignature(signature), 0)
}

// holdsFiber reports whether t is a Fiber or holds one: as a member of a
// union or intersection, as an Effect's success or failure, or as a type
// argument.
func holdsFiber(c *checker.Checker, t *checker.Type, depth int) bool {
	if t == nil || depth > 5 {
		return false
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		for _, member := range t.Types() {
			if holdsFiber(c, member, depth+1) {
				return true
			}
		}
		return false
	}
	if c.GetPropertyOfType(t, "~effect/Fiber") != nil {
		return true
	}
	if isEffectType(c, t) {
		return holdsFiber(c, channelType(c, t, "_A"), depth+1) || holdsFiber(c, channelType(c, t, "_E"), depth+1)
	}
	if t.Flags()&checker.TypeFlagsObject != 0 && t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		for _, argument := range c.GetTypeArguments(t) {
			if holdsFiber(c, argument, depth+1) {
				return true
			}
		}
	}
	return false
}

// bind records that symbol, a binding assigned the fiber, holds it, and
// reports whether it may: a const or let declared in the region.
func (f *fiberFlow) bind(symbol *ast.Symbol) bool {
	if !f.inRegion(symbol) {
		return false
	}
	f.bindings[symbol] = true
	return true
}

// inRegion reports whether symbol is a const or let declared in the region,
// outside any function within it that does not run where it stands.
func (f *fiberFlow) inRegion(symbol *ast.Symbol) bool {
	if symbol == nil || symbol.ValueDeclaration() == nil {
		return false
	}
	declaration := symbol.ValueDeclaration()
	if !ast.IsVariableDeclaration(declaration) || !ast.IsIdentifier(declaration.Name()) {
		return false
	}
	if flags := ast.GetCombinedNodeFlags(declaration) & ast.NodeFlagsBlockScoped; flags != ast.NodeFlagsLet && flags != ast.NodeFlagsConst {
		return false
	}
	for n := declaration; n != nil; n = n.Parent {
		if n == f.region {
			return true
		}
		if isFunctionBoundary(n) && !isRegionTransparent(n) {
			return false
		}
	}
	return false
}

// transparentValue returns the expression whose value fn, a function the
// parser wrote that runs where it stands (isRegionTransparent), gives: the
// call of a do block's or a match expression's function, or a catch
// expression.
func transparentValue(fn *ast.Node) *ast.Node {
	if ast.IsParenthesizedExpression(fn.Parent) {
		return fn.Parent.Parent
	}
	return fn.Parent
}

// noun is how the message refers to the region a second time.
func (f *fiberFlow) noun() string {
	_, noun := regionNames(f.region)
	return noun
}

// regionNames returns how EK4838 names region and refers to it again.
func regionNames(region *ast.Node) (string, string) {
	parent := region.Parent
	switch {
	case isFunctionBoundary(parent):
		switch {
		case isProgramArrow(parent) && parent.Parent != nil && fiberHelper(parent.Parent) == "$forConcurrent":
			return "this for concurrent loop's item", "item"
		case isProgramArrow(parent) && parent.Parent != nil && ast.IsCallExpression(parent.Parent) && ast.IsIdentifier(parent.Parent.Expression()) && parent.Parent.Expression().Text() == "fork":
			return "this fork block", "block"
		case isProgramArrow(parent):
			return "this block param", "block param"
		}
		if name := sourceName(parent); name != "" {
			return name + "'s body", "body"
		}
		return "this function's body", "body"
	case ast.IsIterationStatement(parent, false /*lookInLabeledStatements*/):
		return "this loop iteration", "iteration"
	case parent.Kind == ast.KindTryStatement && parent.AsTryStatement().FinallyBlock == region:
		return "this finally block", "block"
	case parent.Kind == ast.KindTryStatement:
		return "this try block", "block"
	case parent.Kind == ast.KindCatchClause:
		return "this catch block", "block"
	case handleClauseOfBlock(region) != nil:
		return "this handle clause", "clause"
	case isProvideBlock(region):
		return "this provide block", "block"
	case maskWord(region) != "":
		return "this " + maskWord(region) + " block", "block"
	}
	return "this block", "block"
}

// report reports EK4838 at the fork whose fiber goes where out says, with
// the lifetimes that let it.
func (f *fiberFlow) report(out *fiberEscape) {
	owner, _ := regionNames(f.region)
	d := report(f.c, f.fork.Expression(), EK4838, owner, out.how)
	program := forkProgramText(f.file, f.fork)
	if strings.ContainsRune(program, '\n') || len(program) > 60 {
		program = "() => …"
	}
	note(d, "Give it the caller's lifetime: Effect.forkScoped({0})", program)
	note(d, "Or give it no owner: detach({0}), or a scope you hold: forkIn(scope, {0})", program)
	if out.captured {
		note(d, "To bound a join, race it in the region instead: try.race [Fiber.join(fiber), effect { try sleep(d); throw new Late() }]")
	}
}

// forkProgramText returns the program that call, a fork, starts, written as
// a function: `fork heartbeat()` starts `() => heartbeat()`, and `fork {
// ... }` and `fork(() => ...)` start their own function.
func forkProgramText(file *ast.SourceFile, call *ast.Node) string {
	arguments := call.Arguments()
	if len(arguments) == 0 {
		return "() => …"
	}
	program := arguments[0]
	switch {
	case isProgramArrow(program):
		return "() => " + nodeText(file, program.Body()) // fork { ... }
	case ast.IsFunctionExpressionOrArrowFunction(program):
		return nodeText(file, program)
	}
	return "() => " + nodeText(file, program)
}

// escapingFiberFix is EK4838's quick fix (D386): Effect.forkScoped gives the
// fiber the caller's lifetime, adding Scope to the function's requirements,
// and detach gives it no owner. Each changes the fiber's lifetime, so each
// is an editor action a person chooses, absent from --fix's safe list.
var escapingFiberFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4838.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var call *ast.Node
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if call != nil {
				return true
			}
			if ast.IsCallExpression(node) && node.Expression().Kind == ast.KindIdentifier && node.Expression().Text() == "fork" && node.Expression().Loc.ContainsInclusive(fix.Span.Pos()) {
				call = node
				return true
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if call == nil || len(call.Arguments()) != 1 {
			return nil, nil
		}
		program := forkProgramText(fix.SourceFile, call)
		span := fix.LS.ToLSPRange(fix.SourceFile, tsFormSpan(fix.SourceFile, call))
		return []*ls.CodeAction{
			{Description: "Write Effect.forkScoped to give the fiber the caller's lifetime", Changes: []*lsproto.TextEdit{{Range: span, NewText: "Effect.forkScoped(" + program + ")"}}},
			{Description: "Write detach to give the fiber no owner", Changes: []*lsproto.TextEdit{{Range: span, NewText: "detach(" + program + ")"}}},
		}, nil
	},
}
