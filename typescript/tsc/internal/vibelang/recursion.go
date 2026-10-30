package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Recursion (D52).
//
// E and R of a function come from its body, and the body reads the E and R of
// each .vibe function it calls. Functions that call each other, directly or
// through others, form a strongly connected component of that call graph. Its
// E and R are a fixpoint, computed inside the component only: every member
// starts with empty E and R, and the analyzer reads each member's body again,
// with the E and R found so far, until no member's E or R grows. The rows are
// finite and each step only adds to them, so the iteration ends. A component
// is solved after every component it calls, so nothing outside it is read
// twice.
//
//	function isEven(n: number): Effect<boolean, infer E, infer R> {
//	  if (n === 0) return true
//	  return isOdd(n - 1)
//	}
//	function isOdd(n: number): Effect<boolean, infer E, infer R> {
//	  if (n === 7) throw new Odd({ n })
//	  if (n === 0) return false
//	  return isEven(n - 1)
//	}
//	// both: Effect<boolean, Odd, never>
//
// A is TypeScript's to infer. When A depends on the function's own result, as
// it would above without the annotations, TypeScript gives up (TS7023), and
// the function needs a written contract: EK9206.

func init() {
	fileChecks = append(fileChecks, checkRecursion)
}

// bodyCallees returns the .vibe functions whose bodies fn's E and R read: the
// callees of the calls that run in fn's own body, except a callee whose
// contract states its E and R, or a generic callee that the call
// instantiates, whose E and R come from the call's type.
func (a *analyzer) bodyCallees(fn *ast.Node) []*ast.Node {
	var callees []*ast.Node
	a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
		if !a.runs(call) {
			return false
		}
		sig := a.checker.GetResolvedSignature(call)
		callee := implementationOf(sig.Declaration())
		// D269 excludes factory bodies; S3-3 keeps plain returned programs out of body cycles.
		if callee == nil || !isLowerable(callee) || a.isFactory(callee) || sig.Target() != nil || !a.isSplittable(callee) && !a.isEffect(callee) || slices.Contains(callees, callee) {
			return false
		}
		if k := a.contractOf(callee); k != nil && !k.inferredAny() {
			return false
		}
		callees = append(callees, callee)
		return false
	})
	return callees
}

// solve computes the effectInfo of fn and of each function fn's body reads
// that is not solved yet, one strongly connected component at a time, with
// Tarjan's algorithm: a component is solved after every component it calls.
func (a *analyzer) solve(fn *ast.Node) {
	index := map[*ast.Node]int{}
	low := map[*ast.Node]int{}
	var stack []*ast.Node
	onStack := map[*ast.Node]bool{}
	var connect func(v *ast.Node)
	connect = func(v *ast.Node) {
		index[v] = len(index)
		low[v] = index[v]
		stack = append(stack, v)
		onStack[v] = true
		a.connecting[v] = true
		for _, w := range a.bodyCallees(v) {
			if _, done := a.effects[w]; done {
				continue
			}
			if _, solving := a.approx[w]; solving {
				continue // an outer solve owns w's component
			}
			if _, seen := index[w]; !seen {
				connect(w)
				low[v] = min(low[v], low[w])
			} else if onStack[w] {
				low[v] = min(low[v], index[w])
			}
		}
		if low[v] != index[v] {
			return
		}
		var component []*ast.Node
		for {
			w := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			onStack[w] = false
			component = append(component, w)
			if w == v {
				break
			}
		}
		a.solveComponent(component)
	}
	connect(fn)
}

// solveComponent computes the effectInfo of each function in component. A
// function that calls none of the component, itself included, is read once.
// The members of a cycle start with empty E and R and are read until their E
// and R stop growing.
func (a *analyzer) solveComponent(component []*ast.Node) {
	cycle := len(component) > 1 || slices.Contains(a.bodyCallees(component[0]), component[0])
	for _, member := range component {
		a.approx[member] = &effectInfo{}
		if cycle {
			a.recursive[member] = true
		}
	}
	for {
		grew := false
		for _, member := range component {
			info := a.flowOf(member.Body())
			if !a.sameChannels(info, a.approx[member]) {
				grew = true
			}
			a.approx[member] = info
		}
		if !cycle || !grew {
			break
		}
	}
	for _, member := range component {
		a.effects[member] = a.approx[member]
		delete(a.approx, member)
		delete(a.connecting, member)
	}
}

// sameChannels reports whether x and y list the same E and R.
func (a *analyzer) sameChannels(x, y *effectInfo) bool {
	c := a.checker
	return c.GetUnionType(x.errors) == c.GetUnionType(y.errors) && c.GetUnionType(x.requirements) == c.GetUnionType(y.requirements)
}

// ownerFunction returns the function whose own body evaluates node, or nil at
// a module's top level.
func ownerFunction(node *ast.Node) *ast.Node {
	for n := node.Parent; n != nil; n = n.Parent {
		if isFunctionBoundary(n) {
			return n
		}
	}
	return nil
}

// selfCallType types call, which runs a .vibe function whose contract writes
// A and infers E or R, while the checker resolves that contract. Reading the
// inferred channels from the body types the body, and a call of the function
// there, as in `return n * fact(n - 1)`, would ask for the contract being
// resolved (TS2577). The call stands for its success value, so it gets the
// contract's A, and E and R as the fixpoint has found them so far (D52, D57);
// nothing reads them from this type, since the analyzer reads the call's E and
// R from the body. A call in a position that may hold the program instead,
// such as an argument passed by name, keeps TypeScript's error.
func selfCallType(c *checker.Checker, call *ast.Node, signature *checker.Signature) *checker.Type {
	fn := implementationOf(signature.Declaration())
	if fn == nil || !isLowerable(fn) || !isInvocation(call) || !inLowerableBody(call) || !takesSuccess(c, call) {
		return nil
	}
	a := analyzerFor(c)
	k := a.contractOf(fn)
	if k == nil || k.reference == nil || k.inferred(channelA) || !k.inferredAny() || a.isFactory(fn) {
		return nil
	}
	t := c.GetTypeFromTypeNode(k.annotation)
	effect := effectInterface(c, t)
	if effect == nil {
		return nil
	}
	info := a.approx[fn]
	if info == nil {
		info = &effectInfo{}
	}
	channels := []*checker.Type{successType(c, t), channelType(c, t, "_E"), channelType(c, t, "_R")}
	if k.inferred(channelE) {
		channels[channelE] = c.GetUnionType(info.errors)
	}
	if k.inferred(channelR) {
		channels[channelR] = c.GetUnionType(info.requirements)
	}
	return c.NewTypeReference(effect, channels)
}

// takesSuccess reports whether call stands where only its success value is
// used, whatever the types around it: an operand of an operator that makes a
// new value, a condition, a receiver, an index, an unannotated initializer, a
// return or a statement. An argument, an element, a property, a logical
// operand or an assignment can hold the program itself, as where a
// parameter's type asks for an Effect (D147).
func takesSuccess(c *checker.Checker, call *ast.Node) bool {
	if holdsProgram(c, call) {
		return false
	}
	node := call
	for node.Parent != nil {
		parent := node.Parent
		if ast.IsParenthesizedExpression(parent) || parent.Kind == ast.KindConditionalExpression && parent.AsConditionalExpression().Condition != node {
			node = parent // a conditional's arm stands where the conditional does
			continue
		}
		break
	}
	parent := node.Parent
	if parent == nil {
		return false
	}
	switch parent.Kind {
	case ast.KindBinaryExpression:
		operator := parent.AsBinaryExpression().OperatorToken.Kind
		return parent.Flags&ast.NodeFlagsVibeLang == 0 && !ast.IsAssignmentOperator(operator) && !ast.IsLogicalOrCoalescingBinaryOperator(operator) && operator != ast.KindCommaToken // not a pipe or a catch expression
	case ast.KindPrefixUnaryExpression, ast.KindTemplateSpan, ast.KindReturnStatement, ast.KindExpressionStatement, ast.KindIfStatement,
		ast.KindWhileStatement, ast.KindDoStatement, ast.KindSwitchStatement, ast.KindCaseClause, ast.KindElementAccessExpression, ast.KindTypeOfExpression:
		return true
	case ast.KindConditionalExpression:
		return parent.AsConditionalExpression().Condition == node
	case ast.KindPropertyAccessExpression:
		return parent.Expression() == node
	case ast.KindVariableDeclaration:
		return parent.Type() == nil && parent.Initializer() == node
	}
	return false
}

// checkRecursiveContract reports EK9206 at the contract of fn when it writes
// A and infers E or R, and TypeScript could not read it: a call of fn in
// fn's own body, or on its call cycle, stands where its program may be held,
// such as an argument, or fn is generic, so typing the call asked for the
// contract being read (TS2577, which this covers). Writing every channel
// breaks the cycle. It also reports EK9206 when the contract TypeScript gave
// fn holds less than its cycle's fixpoint, so a caller read it too early.
func (a *analyzer) checkRecursiveContract(fn *ast.Node) {
	k := a.contractOf(fn)
	if k == nil || k.reference == nil || k.inferred(channelA) || !k.inferredAny() || a.isFactory(fn) || a.reentered[fn] {
		return
	}
	c := a.checker
	t := c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(fn))
	info := a.effectOf(fn)
	if info == nil {
		return
	}
	name := functionDisplayName(fn)
	whole := a.wholeContract(fn)
	if t.Flags()&checker.TypeFlagsAny != 0 {
		d := report(c, fn.Type(), EK9206.With("{0} calls itself where TypeScript needs its contract before it can infer the contract's channels, so its contract must write every channel."), name)
		if len(fn.TypeParameters()) > 0 {
			note(d, "Write {0}: a generic function's call of itself needs its whole contract.", whole)
		} else {
			note(d, "Write {0}, or call {1} where only its value is used, such as an operand or a variable's initializer.", whole, name)
		}
		if d != nil {
			cover(c, fn.Type())
		}
		return
	}
	if !a.recursive[fn] {
		return
	}
	if k.inferred(channelE) && channelType(c, t, "_E") != c.GetUnionType(info.errors) || k.inferred(channelR) && channelType(c, t, "_R") != c.GetUnionType(info.requirements) {
		d := report(c, fn.Type(), EK9206.With("{0} is on a call cycle that TypeScript typed before the cycle's E and R were known, so its contract must be written."), name)
		note(d, "Write {0}.", whole)
	}
}

// wholeContract returns fn's contract with every channel written, as A!E!R:
// each channel as fn's contract writes it, else E and R as the cycle's
// fixpoint found them, and A as the placeholder A.
func (a *analyzer) wholeContract(fn *ast.Node) string {
	c := a.checker
	info := a.effectOf(fn)
	if info == nil {
		info = &effectInfo{}
	}
	channels := []string{"A", c.TypeToString(c.GetUnionType(info.errors)), c.TypeToString(c.GetUnionType(info.requirements))}
	if k := a.contractOf(fn); k != nil && k.reference != nil {
		for i := range channels {
			if i < len(k.channels) && !k.inferred(i) {
				channels[i] = scanner.GetTextOfNode(k.channels[i])
			}
		}
	}
	return bangText(channels...)
}

// readsInferredContract reports whether a contract that writes fn's A and
// infers E and R can be read: fn is not generic, and every call in its body
// of a function on a call cycle stands where only its value is used
// (selfCallType). Otherwise the contract must write every channel.
func (a *analyzer) readsInferredContract(fn *ast.Node) bool {
	if len(fn.TypeParameters()) > 0 {
		return false
	}
	return !forEachCallInBody(fn, func(call *ast.Node) bool {
		sig := a.checker.GetResolvedSignature(call)
		if sig == nil {
			return false
		}
		callee := implementationOf(sig.Declaration())
		return callee != nil && (callee == fn || a.recursive[callee]) && !takesSuccess(a.checker, call)
	})
}

// checkRecursion reports EK9206 for each function on a call cycle in file
// whose A TypeScript could not infer because it depends on the function's own
// result, and covers TypeScript's TS7022, TS7023, or TS7024 there. It also
// reports EK9206 where the checker typed a catch variable, or a function, on a
// cycle before the cycle's E and R were known: there the written contracts
// break the cycle.
func checkRecursion(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if a.reentered[node] {
			a.checkReenteredFunction(node)
		}
		if isLowerable(node) && node.Type() == nil && a.isEffect(node) {
			a.effectOf(node) // solves node's component
			if a.recursive[node] {
				a.checkRecursiveFunction(node)
			}
		}
		if isLowerable(node) && node.Type() != nil {
			a.checkRecursiveContract(node)
		}
		if node.Kind == ast.KindCatchClause && catches(node.Parent) && node.AsCatchClause().VariableDeclaration != nil && node.AsCatchClause().VariableDeclaration.Type() == nil {
			if fn := ownerFunction(node); fn != nil && a.recursive[fn] {
				a.checkRecursiveCatch(node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func (a *analyzer) checkRecursiveFunction(fn *ast.Node) {
	c := a.checker
	name := functionDisplayName(fn)
	t := c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(fn))
	at := fn
	if fn.Name() != nil {
		at = fn.Name()
	} else if parent := fn.Parent; parent.Kind == ast.KindVariableDeclaration {
		at = parent.Name()
	}
	if t.Flags()&checker.TypeFlagsAny != 0 {
		d := report(c, at, EK9206, name)
		if a.readsInferredContract(fn) {
			note(d, "Write its contract with its success type as A, such as Effect<number, infer E, infer R>, which still infers E and R.")
		} else {
			note(d, "Write every channel of its contract with its success type as A: {0}.", a.wholeContract(fn))
		}
		cover(c, at)
		if parent := fn.Parent; parent.Kind == ast.KindVariableDeclaration {
			cover(c, parent.Name())
		}
		return
	}
	info := a.effectOf(fn)
	if channelType(c, t, "_E") != c.GetUnionType(info.errors) || channelType(c, t, "_R") != c.GetUnionType(info.requirements) {
		d := report(c, at, EK9206.With("{0} is on a call cycle that TypeScript typed before the cycle's E and R were known, so its contract must be written."), name)
		note(d, "Write its contract, such as Effect<A, infer E, infer R>, or write the contract of a function it calls on the cycle.")
	}
}

// checkReenteredFunction reports EK9206 at fn, whose E and R TypeScript read
// while fn's own callees were being found: a call of fn passed by name in
// fn's body is typed from fn's contract, so where the contract leaves E or R
// to inference, the call was typed before they were known.
func (a *analyzer) checkReenteredFunction(fn *ast.Node) {
	c := a.checker
	name := functionDisplayName(fn)
	at := fn
	if fn.Name() != nil {
		at = fn.Name()
	} else if parent := fn.Parent; parent.Kind == ast.KindVariableDeclaration {
		at = parent.Name()
	}
	d := report(c, at, EK9206.With("{0} calls itself in another call's arguments, which TypeScript typed before {0}'s E and R were known, so its contract must write them."), name)
	note(d, "Write every channel of its contract: {0}.", a.wholeContract(fn))
}

// checkRecursiveCatch reports EK9206 at clause when the checker typed its
// variable before the failures of the cycle its try block calls were known.
func (a *analyzer) checkRecursiveCatch(clause *ast.Node) {
	c := a.checker
	declaration := clause.AsCatchClause().VariableDeclaration
	typed := c.GetTypeOfSymbol(c.GetSymbolOfDeclaration(declaration))
	if typed == c.GetUnionType(a.tryBlockFlow(clause.Parent.AsTryStatement().TryBlock).errors) {
		return
	}
	d := report(c, declaration, EK9206.With("This catch handles failures from a call cycle, which were not known when its variable was typed, so the cycle needs a written contract."))
	note(d, "Write the contract of the function this try block calls on the cycle, such as Effect<A, E, infer R>.")
	if d != nil {
		cover(c, clause) // TypeScript's errors about the variable's early type
	}
}
