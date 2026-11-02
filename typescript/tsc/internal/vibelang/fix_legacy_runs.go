package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// Before VIP-1, a call in effect code whose result was an Effect ran where it
// stood, with or without try: as a statement, an initializer, a return value,
// an arm of ?: or match, either side of ?? or ||, the right side of &&, a do
// expression's result, an effect arrow's expression body, a catch
// expression's fallback or handler, an argument, an element or a property
// value. VIP-1 runs it only after try, so the call now gives its program,
// often with no more than EK4802, and the VIP-1 migration (--fix-vip-only)
// writes try there. A legacy migration preserves the old call's run phase,
// and ambiguous source is not reinterpreted: the migration uses its known
// pre-migration model, or refuses (decided detail 274).
//
// legacyRunOf is that model. It reads only what the old rule read: where
// the call stands and whether its result is an Effect (D24: a Config, an Exit
// or an error instance is data; D270: a union of Effects is one). The old
// compiler held a call it passed by name (D147), held in a declared const or
// field (D262, D265, D269), or that a catch, fork, try or an await operation
// runs, and gave an unmarked function's concise body as that function's
// program. Where it decided by more than the call and its position, as by
// inferring an unmarked function's form or passing a whole expression by
// name, legacyRunOf answers legacyUnknown with the reason, and the pass
// reports the site instead of guessing.

// legacyRun is what the pre-flip compiler did with a call.
type legacyRun uint8

const (
	legacyNoRun   legacyRun = iota // it gave its value, or held or passed its program
	legacyRan                      // it ran the Effect the call returns: write try
	legacyUnknown                  // the model can't tell: refuse and report
)

// legacyModel answers for the calls of one file, and remembers which unmarked
// functions the old compiler made Effect functions (marks).
type legacyModel struct {
	a      *analyzer
	marks  map[*ast.Node]bool
	blocks map[*ast.Node]bool // expressions passed by name that become effect blocks (byNameBlock)
	// unmatched holds the offsets where TS2769, no overload matches the
	// call, stands on an argument: such a call's type is the last
	// candidate's, not what the old compiler resolved.
	unmatched map[int]bool
}

func newLegacyModel(a *analyzer, unmatched map[int]bool) *legacyModel {
	return &legacyModel{a: a, marks: map[*ast.Node]bool{}, blocks: map[*ast.Node]bool{}, unmatched: unmatched}
}

// runOf reports what the pre-flip compiler did with call, a call written in
// the source without try, and, for legacyUnknown, why the model can't tell.
func (m *legacyModel) runOf(call *ast.Node) (legacyRun, string) {
	if inHatch(call) || inCatchLeft(call) {
		return legacyNoRun, ""
	}
	if !m.effectResult(call) {
		if m.overloadUnmatched(call) && inEffectCode(call) {
			return legacyUnknown, "no overload of this call matches its arguments (TS2769), so whether it returns an Effect that ran is unknown"
		}
		return legacyNoRun, ""
	}
	owner := effectCodeOwner(call)
	if owner == nil {
		return legacyNoRun, "" // a module's top level or a class field ran nothing (EK1001)
	}
	if !inEffectCode(call) {
		return m.plainOwner(call, owner)
	}
	return legacyEffectPosition(m.a, call, owner)
}

// effectResult reports whether call returns an Effect once the migration
// has written its marks: its result is an Effect now (legacyEffectResult),
// or it calls a function the migration marks effect, whose callers get its
// Effect from then on. Writing a mark and its callers' tries in one round
// keeps each round free of the errors a mark alone adds, as x + 1 for x the
// call of a newly marked function.
func (m *legacyModel) effectResult(call *ast.Node) bool {
	if legacyEffectResult(m.a.checker, call) {
		return true
	}
	signature := m.a.checker.GetResolvedSignature(call)
	if signature == nil || signature.Declaration() == nil {
		return false
	}
	fn := implementationOf(signature.Declaration())
	return fn != nil && isFunctionBoundary(fn) && m.marked(fn)
}

// legacyEffectResult reports whether call returns an Effect that a running
// position runs (callRunsResult without try), reading a present optional
// chain's result.
func legacyEffectResult(c *checker.Checker, call *ast.Node) bool {
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	t := c.GetReturnTypeOfSignature(signature)
	if ast.IsOptionalChain(call) {
		t = presentCallResult(c, t)
	}
	return isEffectType(c, t)
}

// plainOwner decides call in the body of owner, a function without the
// effect mark outside effect code. The old compiler inferred such a function's
// form. Where nothing around it chose a form (marks), it ran the call as an
// Effect function does, and the migration marks it effect. Elsewhere a call
// whose value is the function's result, as a returned conditional's arm,
// gives the same program in either form,
// and a function with a plain return type was plain, so the call gave its
// program. Anything else depended on a form the model doesn't know.
func (m *legacyModel) plainOwner(call *ast.Node, owner *ast.Node) (legacyRun, string) {
	if m.marked(owner) {
		return legacyEffectPosition(m.a, call, owner)
	}
	// A position that held the call, as a declared Effect const or an
	// argument passed by name, held it whatever the function's form.
	if run, _ := legacyEffectPosition(m.a, call, owner); run == legacyNoRun {
		return legacyNoRun, ""
	}
	if legacyResultFlow(call, owner) {
		return legacyNoRun, ""
	}
	if owner.Type() != nil && !isEffectType(m.a.checker, m.a.checker.GetTypeFromTypeNode(owner.Type())) {
		return legacyNoRun, ""
	}
	return legacyUnknown, "this function has no effect mark and its form was inferred before VIP-1 from where it is passed, so whether the call ran is unknown; if it ran, mark the function effect and write try"
}

// marked reports whether the migration marks fn effect: an unmarked function
// that the old compiler made an Effect function, because its own body runs an
// Effect (a try, or a call in a running position that is not its whole
// result) where its position or its return type gave it that form
// (formIsEffect). A catch handler is one: VIP-5 keeps a plain handler's
// result as data, and its quick fix for a handler that fails writes catch
// effect (e) => ….
func (m *legacyModel) marked(fn *ast.Node) bool {
	if done, ok := m.marks[fn]; ok {
		return done
	}
	m.marks[fn] = false // a call cycle through fn answers no
	result := !isMarkedEffect(fn) && isLowerable(fn) && !isProducer(fn) && !isProgramArrow(fn) && (legacyProgramLiteral(m.a, fn) || m.formIsEffect(fn) && m.runsInBody(fn))
	if result && !legacyProgramLiteral(m.a, fn) {
		_, _, result = effectMarkerEdit(ast.GetSourceFileOfNode(fn), fn)
	}
	m.marks[fn] = result
	return result
}

// formIsEffect reports whether the old compiler made fn an Effect function
// once its body ran an Effect: a function whose written return type is an
// Effect, a function declaration or a class method without one (D500), an
// arrow or function expression without one that initializes an unannotated
// variable, a catch expression's handler in effect code, or a function
// literal passed where its parameter expects only a function that returns an
// Effect (D44: the declared parameter type chooses a lambda's form). A
// parameter that expects a plain function, either, or a program left the old
// form to rules the model doesn't follow.
func (m *legacyModel) formIsEffect(fn *ast.Node) bool {
	if fn.Type() != nil {
		// A written return type decides the form (D500): an Effect type, as
		// (n): number!! => …, made an Effect function, and any other type a
		// plain one.
		return isEffectType(m.a.checker, m.a.checker.GetTypeFromTypeNode(fn.Type()))
	}
	switch fn.Kind {
	case ast.KindFunctionDeclaration:
		return true
	case ast.KindMethodDeclaration:
		return fn.Parent != nil && ast.IsClassLike(fn.Parent)
	case ast.KindArrowFunction, ast.KindFunctionExpression:
		if isCatchHandlerOf(fn) {
			return inEffectCode(fn.Parent)
		}
		n := outerParentheses(fn)
		if decl := n.Parent; decl != nil && ast.IsVariableDeclaration(decl) && decl.Initializer() == n {
			return decl.Type() == nil
		}
		owner, path := ownerCall(fn)
		if owner == nil || len(path) == 0 {
			return false
		}
		if ast.IsCallExpression(owner) && ast.SkipParentheses(owner.Expression()).Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 {
			return false
		}
		signature := m.a.checker.GetResolvedSignature(owner)
		if signature == nil {
			return false
		}
		e := m.a.classify(m.a.expectedAt(owner, signature, path, fn))
		return e.effectFn && !e.plainFn && !e.program
	}
	return false
}

// runsInBody reports whether fn's own body, with the arrows the parser calls
// in place, holds a try, or a call the old compiler ran as part of an Effect
// function's body rather than as its result (legacyResultFlow): a function
// whose only runs are its result returns the same program unmarked.
func (m *legacyModel) runsInBody(fn *ast.Node) bool {
	// A throw that can end fn made it an Effect function before VIP-1, so
	// the throw was a typed failure; left plain it is a JavaScript exception,
	// a defect (VIP-4).
	if fn.Body() != nil && hasEscapingThrow(fn) {
		return true
	}
	file := ast.GetSourceFileOfNode(fn)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) && !isCalledInPlace(node) {
			return false
		}
		if ast.IsCallExpression(node) && isInvokedForm(file, node) && strings.HasPrefix(nodeText(file, node), "throw") {
			return true // a throw expression
		}
		if catchExpressionOf(node) != nil {
			// A catch expression ran its left side in an Effect function
			// before VIP-1, and outside effect code it is EK0504 after it
			// (foldkit-130: (text): T!! => Effect.try(…) catch … was left
			// unmarked).
			return true
		}
		if isInvocation(node) && !inHatch(node) && !inCatchLeft(node) {
			// A try, or, in a function whose written contract is an Effect,
			// a call of an Effect value, as Crypto.Crypto() or Port() read a
			// service or a Config there; a plain function's such call stays,
			// TS2349.
			if isTry(node) || fn.Type() != nil && legacyEffectValueCall(m.a, file, node) {
				return true
			}
			// A handler's result is data unless it ran it (VIP-5), so its
			// whole result counts too.
			if ast.IsCallExpression(node) && node.Expression().Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) == 0 && m.effectResult(node) && (!legacyResultFlow(node, fn) || isCatchHandlerOf(fn)) {
				if run, _ := legacyEffectPosition(m.a, node, fn); run == legacyRan {
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	body := fn.Body()
	return body != nil && visit(body)
}

// legacyEffectPosition decides call in effect code whose owner is owner. It
// walks from call to owner's body and stops at the first position that held
// the call or passed it by name.
func legacyEffectPosition(a *analyzer, call *ast.Node, owner *ast.Node) (legacyRun, string) {
	c := a.checker
	for n := call; n != nil && n != owner; n = n.Parent {
		if legacyTryOperand(n) {
			// try runs its operand's value: a call that is that value, as
			// an arm of try (c ? a() : b()), runs there; a call inside it,
			// as an argument, runs where it stands.
			if legacyValueOf(call, n) {
				return legacyNoRun, ""
			}
			continue
		}
		if held, reason := legacyHeldAt(a, n); held {
			// The position held n's program: the call itself when n's value
			// is the call's, as the inner pipe of a |> f(%) |> g(%) is f(%).
			if legacyValueOf(call, n) {
				return legacyNoRun, ""
			}
			return legacyUnknown, reason
		}
	}
	if legacyResultFlow(call, owner) {
		if success := legacyDeclaredSuccess(a, owner); success != nil && (a.isExpectedEffect(success) || a.mayBeExpectedEffect(success) || isEffectSubtype(c, success)) {
			return legacyUnknown, "the function's written success type is an Effect, so whether the returned call ran is unknown"
		}
	}
	return legacyRan, ""
}

// legacyHeldAt reports whether n stands where the old compiler held a program
// unrun, and what held it: an argument, element or property value that its
// call's parameter expects as an Effect (D147), a pipe's left side that such
// a topic passes (D155), a declared Effect const or field (D262, D265,
// D269), an Effect type assertion, an await operation's element, or a
// keyword form's operand (D322).
func legacyHeldAt(a *analyzer, n *ast.Node) (bool, string) {
	held, _, reason := legacyHold(a, n)
	return held, reason
}

// legacyHold is legacyHeldAt, and reports whether the position passed n by
// name (D147, D155): a program that runs the calls in n when it runs.
func legacyHold(a *analyzer, n *ast.Node) (held bool, byName bool, reason string) {
	c := a.checker
	if holdsProgram(c, n) {
		// A declared Effect const (D262, D269); a contextual Effect field
		// (D265) passes its expression by name.
		byName := vibelangmapper.HeldConstDeclaration(n) == nil
		return true, byName, "the expression is held as a declared program, so whether the call in it ran is unknown"
	}
	if outer := outerParentheses(n); outer.Parent != nil && ast.IsPropertyAssignment(outer.Parent) && outer.Parent.Initializer() == outer {
		// A field whose contextual type is an Effect held its program (D265),
		// as fetch: Effect.succeed(response) does in an object an effect
		// block returns, where the signature's context does not reach.
		if contextual := c.GetContextualType(outer, checker.ContextFlagsNone); contextual != nil && a.isExpectedEffect(contextual) {
			return true, true, "the expression is a field whose type is an Effect, which holds its program (D265), so the call in it ran inside that program"
		}
	}
	if pipe := pipeOfLeft(n); pipe != nil {
		// The left side of a pipe is passed by name when a topic of its
		// body is (D155), as decode(x) |> Effect.mapError(%, f) passes it.
		for _, topic := range topicsOf(pipe) {
			if held, _ := legacyHeldAt(a, topic); held {
				return true, true, "the expression is a pipe's left side that its topic passes by name (D155), so the call in it ran inside that program"
			}
		}
	}
	if awaitLiteralOperation(n) != nil {
		return true, false, "the expression is an element of an await operation, which runs it as a program"
	}
	if parent := n.Parent; parent != nil && (parent.Kind == ast.KindAsExpression || parent.Kind == ast.KindTypeAssertionExpression) && parent.Type() != nil {
		if a.isExpectedEffect(c.GetTypeFromTypeNode(parent.Type())) {
			return true, false, "the expression is asserted to be an Effect, which describes a delayed program (D147)"
		}
	}
	owner, path := ownerCall(n)
	if owner == nil || len(path) == 0 || isTryCall(owner) {
		// try's operand is no parameter: legacyTryOperand decides it.
		return false, false, ""
	}
	if ast.IsCallExpression(owner) {
		callee := ast.SkipParentheses(owner.Expression())
		if callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 && !isCalledInPlace(callee) {
			return true, false, "the expression is the operand of a keyword form, which takes a program by syntax (D322)"
		}
	}
	signature := c.GetResolvedSignature(owner)
	if signature == nil {
		return false, false, ""
	}
	if a.classify(a.expectedAt(owner, signature, path, n)).program {
		return true, true, "the expression is passed by name to a parameter that expects an Effect (D147), so the call in it ran inside that program"
	}
	return false, false, ""
}

// legacyResultFlow reports whether call's value can be owner's result:
// owner's expression body or a returned expression, through parentheses,
// conditional arms, ?? and ||, the right side of &&, and the arrows the
// parser calls in place, as a match arm or a do expression's result.
func legacyResultFlow(call *ast.Node, owner *ast.Node) bool {
	n := call
	for {
		parent := n.Parent
		switch {
		case parent == nil:
			return false
		case parent == owner:
			return owner.Body() == n
		case isFunctionBoundary(parent):
			if !isCalledInPlace(parent) {
				return false
			}
			if parent.Body() != n {
				return false
			}
			n = parent.Parent.Parent // the call that invokes it
			continue
		case ast.IsParenthesizedExpression(parent):
		case isPipe(parent) && parent.AsBinaryExpression().Right == n:
		case parent.Kind == ast.KindConditionalExpression:
			if parent.AsConditionalExpression().Condition == n {
				return false
			}
		case ast.IsBinaryExpression(parent):
			switch parent.AsBinaryExpression().OperatorToken.Kind {
			case ast.KindQuestionQuestionToken, ast.KindBarBarToken:
			case ast.KindAmpersandAmpersandToken:
				if parent.AsBinaryExpression().Right != n {
					return false
				}
			default:
				return false
			}
		case parent.Kind == ast.KindReturnStatement:
			fn := enclosingFunction(parent)
			if fn == owner {
				return true
			}
			if fn == nil || !isCalledInPlace(fn) {
				return false
			}
			n = fn.Parent.Parent
			continue
		case ast.IsStatement(n) || ast.IsBlock(n):
			// A statement of an in-place arrow's body, as a match's switch
			// or a do expression's block, holds its returns.
		default:
			return false
		}
		n = parent
	}
}

// legacyDeclaredSuccess returns the success type that owner's written return
// type, or an effect block's declared Effect type, gives, or nil.
func legacyDeclaredSuccess(a *analyzer, owner *ast.Node) *checker.Type {
	c := a.checker
	if owner.Type() != nil {
		declared := c.GetTypeFromTypeNode(owner.Type())
		if success := successType(c, declared); success != nil {
			return success
		}
		return declared
	}
	if isEffectBlock(owner) {
		if declared := c.GetContextualType(owner, checker.ContextFlagsNone); declared != nil && isEffectType(c, declared) {
			return successType(c, declared)
		}
	}
	return nil
}

// wrapperTry reports whether call, written try f() in effect code, called a
// known legacy plain-variant wrapper: f is a function declaration or a class
// method without a return type, which the old compiler made an Effect
// function (D500) and which the migration leaves plain because its body runs
// nothing, and its result is not an Effect. The old try ran the wrapper to get
// that result as its success datum; the plain call gives it directly, so the
// try goes, even when the datum is an error instance, which try would now
// fail with (decided detail 274). A call that returns an Effect under its
// contract keeps its try.
func (m *legacyModel) wrapperTry(call *ast.Node) bool {
	if call.Flags&ast.NodeFlagsVibeLangTry == 0 || !ast.IsCallExpression(call) || !inEffectCode(call) || inHatch(call) {
		return false
	}
	c := m.a.checker
	signature := c.GetResolvedSignature(call)
	if signature == nil || signature.Declaration() == nil {
		return false
	}
	fn := implementationOf(signature.Declaration())
	if fn == nil || fn.Kind != ast.KindFunctionDeclaration && fn.Kind != ast.KindMethodDeclaration || !m.formIsEffect(fn) {
		return false
	}
	if isMarkedEffect(fn) || !isLowerable(fn) || isProducer(fn) || fn.Type() != nil || m.marked(fn) {
		return false
	}
	return !isEffectType(c, c.GetReturnTypeOfSignature(signature))
}

// byNameBlock reports whether the migration writes n, an expression the old
// compiler passed by name (D147, D155), as an effect block: n holds calls
// that ran inside the program it passed, as snapshotDecoded(value) ran in
// SchemaBridge.recover(decode(snapshotDecoded(value)), …). The program ran n
// in an Effect body, so effect { return try n } with those calls tried means
// what it meant, the program its parameter receives (D147: "as if written
// () => fetchReport()"). A function written inside n keeps its own form, so
// such an n is left to the reported refusal.
func (m *legacyModel) byNameBlock(n *ast.Node) bool {
	if done, ok := m.blocks[n]; ok {
		return done
	}
	m.blocks[n] = false
	result := false
	if parent := n.Parent; parent != nil && (ast.IsCallExpression(parent) || ast.IsNewExpression(parent) || ast.IsArrayLiteralExpression(parent) || ast.IsPropertyAssignment(parent) || isPipe(parent)) && !ast.IsParenthesizedExpression(n) {
		if owner := effectCodeOwner(n); owner != nil && (inEffectCode(n) || m.marked(owner)) && !legacyHoldsFunction(n) {
			if held, byName, _ := legacyHold(m.a, n); held && byName {
				result = len(m.blockRuns(n)) > 0
			}
		}
	}
	m.blocks[n] = result
	return result
}

// legacyHoldsFunction reports whether n holds a function written in the
// source, other than the arrows the parser calls in place.
func legacyHoldsFunction(n *ast.Node) bool {
	found := false
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) && !isCalledInPlace(node) {
			found = true
			return true
		}
		return node.ForEachChild(visit)
	}
	visit(n)
	return found
}

// blockRuns returns the calls inside block, an expression passed by name,
// that ran inside its program: each that block's Effect body ran where it
// stood, outside a position held within block.
func (m *legacyModel) blockRuns(block *ast.Node) []*ast.Node {
	var runs []*ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node != block && isInvocation(node) && !tried(node) && node.Flags&ast.NodeFlagsVibeLangTry == 0 && !isTryCall(node) && triesSyntax(m.a, ast.GetSourceFileOfNode(node), node) && m.effectResult(node) {
			ran := true
			for p := node; p != block; p = p.Parent {
				if held, _ := legacyHeldAt(m.a, p); held {
					ran = false
					break
				}
			}
			if ran {
				runs = append(runs, node)
			}
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return runs
}

// blockText returns the effect block the migration writes for block
// (byNameBlock): its text with try before each call that ran in it, a
// nested block written the same way, and try before the whole when it is an
// Effect.
func (m *legacyModel) blockText(file *ast.SourceFile, block *ast.Node) string {
	text := file.Text()
	start := scanner.SkipTrivia(text, block.Pos())
	runs := map[*ast.Node]bool{}
	for _, call := range m.blockRuns(block) {
		runs[call] = true
	}
	var edits []sourceEdit
	opens := map[int]int{}
	insert := func(at int, s string) {
		if i, ok := opens[at]; ok {
			edits[i].text += s
			return
		}
		opens[at] = len(edits)
		edits = append(edits, sourceEdit{at, at, s})
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		at := scanner.SkipTrivia(text, node.Pos())
		if m.byNameBlock(node) {
			edits = append(edits, sourceEdit{at - start, node.End() - start, m.blockText(file, node)})
			return false
		}
		if runs[node] {
			if tryNeedsParentheses(node) {
				insert(at-start, "(try ")
				edits = append(edits, sourceEdit{node.End() - start, node.End() - start, ")"})
			} else {
				insert(at-start, "try ")
			}
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	body := applyEdits(text[start:block.End()], edits)
	if isEffectType(m.a.checker, m.a.checker.GetTypeAtLocation(block)) {
		inner := ast.SkipParentheses(block)
		if isInvocation(inner) || ast.IsIdentifier(inner) || ast.IsPropertyAccessExpression(inner) {
			body = "try " + body
		} else {
			body = "try (" + body + ")"
		}
	}
	return "effect { return " + body + " }"
}

// overloadUnmatched reports whether TS2769 stands on one of call's own
// arguments: the checker found no overload, and typed the call by its last
// candidate.
func (m *legacyModel) overloadUnmatched(call *ast.Node) bool {
	if len(m.unmatched) == 0 || !ast.IsCallExpression(call) {
		return false
	}
	text := ast.GetSourceFileOfNode(call).Text()
	for _, argument := range call.Arguments() {
		if m.unmatched[scanner.SkipTrivia(text, argument.Pos())] {
			return true
		}
	}
	return false
}

// legacyTryOperand reports whether n is the operand of an explicit try.
func legacyTryOperand(n *ast.Node) bool {
	if n.Flags&ast.NodeFlagsVibeLangTry != 0 && ast.IsParenthesizedExpression(n) {
		return true
	}
	parent := n.Parent
	return parent != nil && isTryCall(parent) && tryOperand(parent) == n
}

// legacyValueOf reports whether call's value can be the value of n, its
// ancestor: through parentheses, a pipe's body, conditional arms, ?? and ||,
// and the right side of &&.
func legacyValueOf(call *ast.Node, n *ast.Node) bool {
	for c := call; c != n; c = c.Parent {
		parent := c.Parent
		switch {
		case parent == nil:
			return false
		case ast.IsParenthesizedExpression(parent):
		case isPipe(parent) && parent.AsBinaryExpression().Right == c:
			// a pipe's value is its body's
		case parent.Kind == ast.KindConditionalExpression:
			if parent.AsConditionalExpression().Condition == c {
				return false
			}
		case ast.IsBinaryExpression(parent):
			switch parent.AsBinaryExpression().OperatorToken.Kind {
			case ast.KindQuestionQuestionToken, ast.KindBarBarToken:
			case ast.KindAmpersandAmpersandToken:
				if parent.AsBinaryExpression().Right != c {
					return false
				}
			default:
				return false
			}
		default:
			return false
		}
	}
	return true
}

// legacyEffectValueCall reports whether call calls an Effect value, as
// Users() read a service (D501) and Port() a Config (D24) before VIP-1: a
// call without arguments of a value with no call signature that is an
// Effect, or of a module that names its service. effectValueCallEdits
// rewrites it once its function is marked.
func legacyEffectValueCall(a *analyzer, file *ast.SourceFile, call *ast.Node) bool {
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 0 || call.TypeArguments() != nil || call.QuestionDotToken() != nil || call.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLang) != 0 {
		return false
	}
	c := a.checker
	callee := call.Expression()
	t := c.GetApparentType(c.GetTypeAtLocation(callee))
	if len(c.GetSignaturesOfType(t, checker.SignatureKindCall)) != 0 {
		return false
	}
	return effectOfValue(c, t) != nil || moduleServiceKeyName(c, callee) != ""
}

// legacyProgramLiteral reports whether fn is a function literal without
// parameters that initializes a const whose written type is an Effect, as
// const migrate: void!E!R = () => { … }, or that is passed where its
// parameter expects only a program: the old compiler converted it to the
// program it holds (D7), which VIP-2 writes as an effect block.
func legacyProgramLiteral(a *analyzer, fn *ast.Node) bool {
	if fn.Kind != ast.KindArrowFunction && fn.Kind != ast.KindFunctionExpression || len(fn.Parameters()) != 0 || fn.TypeParameters() != nil || fn.Type() != nil || fn.Name() != nil {
		return false
	}
	if ast.GetFunctionFlags(fn)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0 {
		return false
	}
	n := outerParentheses(fn)
	if decl := n.Parent; decl != nil && ast.IsVariableDeclaration(decl) && decl.Initializer() == n {
		return decl.Type() != nil && a.isExpectedEffect(a.checker.GetTypeFromTypeNode(decl.Type()))
	}
	// An argument or element whose parameter expects only a program, as
	// forkIn's program does: the old compiler chose the literal's form from
	// the parameter (D44) and passed the program it holds (foldkit-131,
	// forkIn(scope, () => work())).
	owner, path := ownerCall(fn)
	if owner == nil || len(path) == 0 || !ast.IsCallExpression(owner) && !ast.IsNewExpression(owner) {
		return false
	}
	if ast.IsCallExpression(owner) && ast.SkipParentheses(owner.Expression()).Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 {
		return false
	}
	signature := a.checker.GetResolvedSignature(owner)
	if signature == nil {
		return false
	}
	e := a.classify(a.expectedAt(owner, signature, path, fn))
	return e.program && !e.effectFn && !e.plainFn
}

// programLiteralEdits returns the edits that write fn, a program literal
// (legacyProgramLiteral), as an effect block: effect { … } for a block
// body, effect { return … } for an expression body.
func programLiteralEdits(file *ast.SourceFile, fn *ast.Node) []sourceEdit {
	text := file.Text()
	start := scanner.SkipTrivia(text, outerParentheses(fn).Pos())
	body := fn.Body()
	bodyStart := scanner.SkipTrivia(text, body.Pos())
	if ast.IsBlock(body) {
		return []sourceEdit{{start, bodyStart, "effect "}}
	}
	end := outerParentheses(fn).End()
	return []sourceEdit{{start, bodyStart, "effect { return "}, {end, end, " }"}}
}

// plainCatch reports whether node is a catch expression that stays outside
// effect code after the migration: in a plain function the migration doesn't
// mark, as an `: infer _` factory's `const attempt: T!! = (effect { … })
// catch () => …`, or at the top level. Before VIP-1 it was the program
// $catchExpression(() => left, handler), which builds its left side each time
// it runs; after it, a catch outside effect code is EK0504. The migration
// writes it as effect { return … }, the same program (foldkit-17067). A catch
// inside another one's left side moves with it.
func (m *legacyModel) plainCatch(node *ast.Node) bool {
	if catchExpressionOf(node) == nil || inEffectCode(node) || inCatchLeft(node) {
		return false
	}
	owner := effectCodeOwner(node)
	return owner == nil || !m.marked(owner)
}
