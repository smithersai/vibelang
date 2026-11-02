package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A JavaScript function such as Array.prototype.map calls its callback
// synchronously, on a stack frame the runtime cannot pause or capture, so a
// callback passed where a plain function is expected must compile to plain
// JavaScript (design D9, D10). A lambda there that performs an Effect
// operation, and a VibeLang function passed by name that can pause, are
// EK4301:
//
//	error EK4301: This callback can't run Users.find(id), an Effect: Array.prototype.map calls it synchronously, as a plain function.
//	  Use Effect.forEach(ids, (id) => Users.find(id)) or a for...of loop.

func init() {
	fileChecks = append(fileChecks, checkCallbacks)
}

// pausingCallback is EK4301's text for a lambda. {0} says what it can't do,
// such as "run find(id), an Effect", and {1} names the callee.
var pausingCallback = EK4301.With("This callback can't {0}: {1} calls it synchronously, as a plain function.")

// effectFunctionCallback is EK4301's text for an Effect function passed by
// name where only a plain function fits (D430, D500).
var effectFunctionCallback = EK4301.With("{0} is an Effect function, but {1} calls it synchronously.")

// callsEffectFunction is EK4301's text for a callback that calls an Effect
// function whose body runs no Effect, which is an Effect function only for
// want of a return annotation (D500).
var callsEffectFunction = EK4301.With("This callback calls the Effect function {0}, but {1} calls it synchronously.")

// noteReturnTypeFix notes on d the return type returnTypeFix writes for
// helper, when it writes one.
func (a *analyzer) noteReturnTypeFix(d *ast.Diagnostic, helper *ast.Node) {
	if helper == nil || a.plainHelperGroup(helper) == nil {
		return
	}
	note(d, "{0} has no return annotation, so it is an Effect function. Its quick fix writes its return type, {1}, which makes it plain; vibelang --fix applies every such fix in the project.", functionDisplayName(helper), ": "+a.returnTypeText(helper))
}

// effectTypedValue is EK4301's text for a function value whose type returns
// an Effect, such as a plain function annotated `: infer _` that returns its
// program: as a value it has its type's form (D511).
var effectTypedValue = EK4301.With("{0} returns an Effect, so as a value it is an Effect function, but {1} calls it synchronously.")

// mayReturnEffectValue is EK4301's text for a function value whose return
// type is a union with an Effect member (D512).
var mayReturnEffectValue = EK4301.With("{0} may return an Effect, but {1} calls it synchronously and would drop the program.")

// listedFailuresValue is EK4301's text for a trusted value that lists
// failures where only a plain function fits (D514).
var listedFailuresValue = EK4301.With("{0} is trusted to throw expected failures, but {1} calls it synchronously, where a listed failure would be a defect.")

// rejectedValueMessage chooses EK4301's text for node, a function value that
// conversion rejected where only a plain function fits.
func (a *analyzer) rejectedValueMessage(node *ast.Node) *Message {
	if failures, ok := trustedValueFailures(a.checker, node); ok && len(failures) > 0 {
		return listedFailuresValue
	}
	if fn := esFunctionOf(a.checker, node); fn != nil && (a.isEffect(fn) || a.isFactory(fn) || a.isSplittable(fn)) {
		return effectFunctionCallback
	}
	for _, signature := range a.checker.GetSignaturesOfType(a.checker.GetTypeAtLocation(node), checker.SignatureKindCall) {
		if isEffectType(a.checker, a.checker.GetReturnTypeOfSignature(signature)) {
			return effectTypedValue
		}
	}
	return mayReturnEffectValue
}

// mixedFormCallee is EK4301's text for a call of a union of functions some of
// which return a definitely-Effect type and some another (D454, D500).
var mixedFormCallee = EK4301.With("{0} is a plain function or an Effect function, so this call would build the Effect function's program and never run it.")

// hasMixedFormCallee reports whether call's callee is a union of function
// types whose members differ in form: some declared to return a
// definitely-Effect type and some another type (D500). Its plain call would
// build the Effect members' programs unrun, so it is EK4301.
func (a *analyzer) hasMixedFormCallee(call *ast.Node) bool {
	c := a.checker
	if !isVibeLangFile(ast.GetSourceFileOfNode(call)) || inHatch(call) {
		return false
	}
	t := c.GetTypeAtLocation(call.Expression())
	if t == nil || t.Flags()&checker.TypeFlagsUnion == 0 {
		return false
	}
	effect, plain := false, false
	for _, member := range t.Types() {
		for _, signature := range c.GetSignaturesOfType(member, checker.SignatureKindCall) {
			if isEffectType(c, c.GetReturnTypeOfSignature(signature)) {
				effect = true
			} else {
				plain = true
			}
		}
	}
	return effect && plain
}

// effectAnnotatedCallback is EK4301's text for a literal whose Effect
// annotation makes it an Effect function where only a plain function fits
// (D500).
var effectAnnotatedCallback = EK4301.With("This callback is an Effect function, annotated {0}, but {1} calls it synchronously.")

// pausingMethod is EK4301's text for a method that implements a plain
// function member, such as Equal.Equal's [Equal.symbol] (D55). {0} is the
// method, {1} what it can't do, {2} the member's owner.
var pausingMethod = EK4301.With("{0} can't {1}: {2} declares it as a plain function, which its callers call synchronously.")

func checkCallbacks(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isLambda(node):
			if a.finalForm(node) == formFactory {
				call, path := ownerCall(node)
				if call != nil {
					if sig := a.candidateOf(call); sig != nil {
						e := a.expectationAt(call, sig, path, node)
						if e.plainFn && !e.effectFn {
							d := report(c, node, EK4301.With("{0} returns a program, but {1} expects a plain function, which returns a value."), upperFirst(functionDisplayName(node)), calleeName(c, file, call))
							note(d, "Run the program and return its value, or pass a function that returns the program as a value.")
						}
					}
				}
			}
			if a.hasContract(node) && a.finalForm(node) == formEffect {
				if call, path := ownerCall(node); call != nil {
					if sig := a.candidateOf(call); sig != nil {
						if e := a.expectationAt(call, sig, path, node); e.plainFn && !e.effectFn {
							report(c, node, effectAnnotatedCallback, nodeText(file, node.Type()), calleeName(c, file, call))
						}
					}
				}
			}
			if f := a.finalForm(node); f == formPlain && !(node.Type() != nil && a.hasPlainContract(node)) {
				if pause := a.pauseWhat(file, node); pause != "" {
					call, _ := ownerCall(node)
					if !reportTracedCallback(c, file, call, node) {
						message := pausingCallback
						first := a.firstPause(node)
						if first != nil && a.runsVariant(first) {
							message = callsEffectFunction
						}
						what := pause
						if message == callsEffectFunction {
							what = nodeText(file, ast.GetInvokedExpression(first)) // the Effect function's name
						}
						d := report(c, node, message, what, calleeName(c, file, call))
						if message == callsEffectFunction {
							a.noteReturnTypeFix(d, a.unannotatedHelperAt(first))
						}
						note(d, pausingCallbackFix(c, file, call, node))
						if call != nil && !ast.IsExpressionStatement(ast.WalkUpParenthesizedExpressions(call).Parent) {
							if sig := a.candidateOf(call); sig != nil {
								_, path := ownerCall(node)
								for _, expected := range a.expectedAt(call, sig, path, node) {
									for _, callback := range c.GetSignaturesOfType(expected, checker.SignatureKindCall) {
										if a.isBareTypeParameter(c.GetReturnTypeOfSignature(callback)) {
											if pause := a.firstPause(node); pause != nil {
												note(d, "To collect the program instead of running it, return a function: {0}() => {1}", callbackHead(file, node), nodeText(file, pause))
											}
										}
									}
								}
							}
						}
					}
				} else {
					call, _ := ownerCall(node)
					a.reportFailingCallback(file, node, call) // D282 (plain_failures.go)
				}
			}
		case node.Kind == ast.KindMethodDeclaration && isLowerable(node):
			if owner := a.plainMemberOwner(node); owner != "" {
				if pause := a.pauseWhat(file, node); pause != "" {
					d := report(c, node.Name(), pausingMethod, nodeText(file, node.Name()), pause, owner)
					note(d, "Compute what it needs before building the object, and keep {0} plain.", nodeText(file, node.Name()))
				} else {
					a.reportFailingMethod(file, node, owner) // D282 (plain_failures.go)
				}
			}
		case ast.IsCallExpression(node) && a.hasMixedFormCallee(node):
			report(c, node.Expression(), mixedFormCallee, nodeText(file, node.Expression()))
		case a.conversions[node] != nil:
			if a.finalConversion(node) == convertRejected {
				call, _ := ownerCall(node)
				// S10-21 covers named callbacks as well as inline lambdas.
				if reportTracedCallback(c, file, call, node) {
					break
				}
				d := report(c, node, a.rejectedValueMessage(node), nodeText(file, node), calleeName(c, file, call))
				if ast.IsIdentifier(node) || ast.IsPropertyAccessExpression(node) {
					a.noteReturnTypeFix(d, a.unannotatedHelperAt(node))
				}
				note(d, "Use {0} or a for...of loop.", forEachFix(c, file, call, node))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// protocolNames are the methods JavaScript calls by name without reading a
// declaration (D397).
var protocolNames = map[string]bool{"toString": true, "toLocaleString": true, "valueOf": true, "toJSON": true, "then": true}

// isProtocolKey reports whether name, a member's name, is a protocol key
// (D397, D484): toString, toLocaleString, valueOf, toJSON, then, a well-known
// symbol such as [Symbol.dispose] or [Symbol.hasInstance], the prelude's
// [customMatcher] (D407), or a protocol symbol of effect (effectProtocolKeys).
// A method there is plain, as is a function literal written there as an
// object literal's field.
func (a *analyzer) isProtocolKey(name *ast.Node) bool {
	if name == nil {
		return false
	}
	switch name.Kind {
	case ast.KindIdentifier, ast.KindStringLiteral:
		return protocolNames[name.Text()]
	case ast.KindComputedPropertyName:
		key := ast.SkipParentheses(name.Expression())
		if ast.IsIdentifier(key) {
			return key.Text() == "customMatcher"
		}
		if !ast.IsPropertyAccessExpression(key) {
			return false
		}
		if owner := key.Expression(); ast.IsIdentifier(owner) && owner.Text() == "Symbol" {
			return true // a well-known symbol: Symbol.dispose, Symbol.iterator, ...
		}
		symbol := a.checker.GetSymbolAtLocation(key)
		if symbol == nil || len(symbol.Declarations()) == 0 {
			return false
		}
		file := ast.GetSourceFileOfNode(symbol.Declarations()[0])
		return effectProtocolKeys[moduleOf(file)+"."+key.Name().Text()] && packageOf(a.checker, file) == "effect"
	}
	return false
}

// effectProtocolKeys are effect's symbols that its own code, or Node's
// util.inspect, calls a method by: Equal.symbol, Hash.symbol, and
// Inspectable.NodeInspectSymbol.
var effectProtocolKeys = map[string]bool{"Equal.symbol": true, "Hash.symbol": true, "Inspectable.NodeInspectSymbol": true}

// atProtocolKey reports whether fn, a function literal, is written as an
// object literal's field at a protocol key, a destination of the plain form
// (D484).
func (a *analyzer) atProtocolKey(fn *ast.Node) bool {
	parent := ast.WalkUpParenthesizedExpressions(fn.Parent)
	return parent != nil && ast.IsPropertyAssignment(parent) && ast.SkipParentheses(parent.Initializer()) == fn && a.isProtocolKey(parent.Name())
}

// plainMemberOwner returns the name of the type whose member method
// implements when that member is a plain function, such as Equal.Equal for
// [Equal.symbol] (D55), and "" otherwise: the method then compiles to a plain
// method, so it must not pause. The member comes from the interfaces that
// method's class implements, or from the contextual type of method's object
// literal.
func (a *analyzer) plainMemberOwner(method *ast.Node) string {
	c := a.checker
	symbol := c.GetSymbolOfDeclaration(method)
	if symbol == nil {
		return ""
	}
	if a.isProtocolKey(method.Name()) {
		return "JavaScript" // D397, D484: JavaScript calls a protocol method by name
	}
	if ast.IsStatic(method) {
		return ""
	}
	var owners []*ast.Node
	var expected []*checker.Type
	switch parent := method.Parent; {
	case ast.IsObjectLiteralExpression(parent):
		if t := c.GetContextualTypeForObjectLiteralElement(method, checker.ContextFlagsSignature); t != nil {
			expected = append(expected, a.declaredMemberType(t))
		}
	case ast.IsClassLike(parent):
		for _, heritage := range ast.GetImplementsHeritageClauseElements(parent) {
			if member := c.GetPropertyOfType(implementedType(c, parent, heritage), symbol.Name()); member != nil {
				expected = append(expected, a.declaredMemberType(c.GetTypeOfSymbol(member)))
				owners = append(owners, heritage)
			}
		}
	}
	e := a.classify(expected)
	if !e.plainFn || e.effectFn || e.program {
		return ""
	}
	if len(owners) > 0 {
		return nodeText(ast.GetSourceFileOfNode(method), owners[0])
	}
	return "its contextual type"
}

// pauseWhat says what fn, which must be plain, can't do, for EK4301: run its
// first call that performs an Effect operation, "run find(id), an Effect",
// else declare its first using declaration, which needs a Scope region (D54),
// "declare using conn, which needs a Scope"; "" when it does neither.
func (a *analyzer) pauseWhat(file *ast.SourceFile, fn *ast.Node) string {
	if pause := a.firstEffectRun(fn); pause != nil {
		return "run " + messageCallText(file, pause) + ", an Effect"
	}
	if list := firstUsing(fn); list != nil {
		if declarations := list.AsVariableDeclarationList().Declarations.Nodes; len(declarations) > 0 {
			return "declare using " + nodeText(file, declarations[0].Name()) + ", which needs a Scope"
		}
	}
	return ""
}

// calleeName names what call calls, for a diagnostic: Array.prototype.map
// for a method an interface or class declares, called on an instance, else
// the callee as written, such as Array.from or Order.mapInput.
func calleeName(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	if call == nil {
		return "its caller"
	}
	if signature := c.GetResolvedSignature(call); signature != nil && !isStaticReceiver(c, receiverOf(call)) {
		if d := signature.Declaration(); d != nil && (ast.IsMethodSignatureDeclaration(d) || ast.IsMethodDeclaration(d)) && d.Parent != nil {
			if owner := d.Parent.Name(); owner != nil && ast.IsIdentifier(owner) && ast.IsIdentifier(d.Name()) {
				return owner.Text() + ".prototype." + d.Name().Text()
			}
		}
	}
	return nodeText(file, call.Expression())
}

// pausingCallbackFix writes EK4301's fix for callback, a lambda that can
// pause, passed to call: a comparator for sort or toSorted cannot run an
// Effect at all, so its Effects run first; a VibeLang function that calls its
// callback synchronously needs a callback type that returns an Effect,
// `(a: A) => B!E!R` (D500); any other callee's elements go through
// Effect.forEach or a loop.
func pausingCallbackFix(c *checker.Checker, file *ast.SourceFile, call *ast.Node, callback *ast.Node) string {
	name := calleeName(c, file, call)
	if strings.HasSuffix(name, ".prototype.sort") || strings.HasSuffix(name, ".prototype.toSorted") {
		return "Run the Effects the comparator needs first, with Effect.forEach or a for...of loop, then sort by their results with a plain comparator."
	}
	if call != nil {
		if signature := c.GetResolvedSignature(call); signature != nil {
			if fn := implementationOf(signature.Declaration()); fn != nil && isLowerable(fn) {
				parameter := "callback"
				if _, path := ownerCall(callback); len(path) == 1 && path[0].argument < len(fn.Parameters()) {
					parameter = nodeText(file, fn.Parameters()[path[0].argument].Name())
				}
				return format("Give {0}'s parameter an Effect contract, so {0} runs it: {1}: () => A!E!R, with E and R in {0}'s return type.", []any{nodeText(file, call.Expression()), parameter})
			}
		}
	}
	return format("Use {0} or a for...of loop.", []any{forEachFix(c, file, call, callback)})
}

// forEachFix writes the Effect.forEach call that replaces call, a call such
// as ids.map(f) whose callback f can pause, when the object call's callee
// belongs to is iterable, and else names Effect.forEach. A long callback is
// written by its parameters, (id) => { … }.
func forEachFix(c *checker.Checker, file *ast.SourceFile, call *ast.Node, callback *ast.Node) string {
	if receiver := receiverOf(call); receiver != nil && c.IteratedType(c.GetTypeAtLocation(receiver)) != nil {
		return "Effect.forEach(" + shortText(nodeText(file, receiver), "items") + ", " + shortText(nodeText(file, callback), callbackHead(file, callback)+"{ … }") + ")"
	}
	return "Effect.forEach"
}

// callbackHead writes callback's parameters as the start of an arrow,
// "(id) => ", for a message that shows the callback's shape.
func callbackHead(file *ast.SourceFile, callback *ast.Node) string {
	if !ast.IsFunctionLike(callback) {
		return "() => "
	}
	var parameters []string
	for _, parameter := range callback.Parameters() {
		parameters = append(parameters, nodeText(file, parameter))
	}
	return shortText("("+strings.Join(parameters, ", ")+") => ", "(…) => ")
}

// receiverOf returns the object that call's callee belongs to, ids in
// ids.map(f), or nil.
func receiverOf(call *ast.Node) *ast.Node {
	if call != nil && ast.IsPropertyAccessExpression(call.Expression()) {
		return call.Expression().Expression()
	}
	return nil
}

// isStaticReceiver reports whether receiver names a namespace, a class, an
// enum, or a value that a declaration file declares, such as Array in
// Array.from, rather than an instance whose methods its prototype holds.
func isStaticReceiver(c *checker.Checker, receiver *ast.Node) bool {
	if receiver == nil || !ast.IsEntityNameExpression(receiver) {
		return false
	}
	symbol := c.GetSymbolAtLocation(receiver)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	if symbol.Flags()&(ast.SymbolFlagsModule|ast.SymbolFlagsClass|ast.SymbolFlagsEnum) != 0 {
		return true
	}
	declaration := symbol.ValueDeclaration()
	return declaration != nil && ast.IsVariableDeclaration(declaration) && ast.GetSourceFileOfNode(declaration).IsDeclarationFile
}

// nodeText returns the source text of node, without leading trivia. Missing,
// synthesized and invalid recovery spans have no source text.
func nodeText(file *ast.SourceFile, node *ast.Node) string {
	if file == nil || ast.NodeIsMissing(node) {
		return ""
	}
	source := file.Text()
	if node.Pos() < 0 || node.End() < node.Pos() || node.End() > len(source) || node.Pos() > len(source) {
		return ""
	}
	start := scanner.SkipTrivia(source, node.Pos())
	if start > node.End() {
		return ""
	}
	return source[start:node.End()]
}

// reportTracedCallback explains Effect.fn's body convention without claiming
// that it is an ordinary synchronous callback API (S10-21).
func reportTracedCallback(c *checker.Checker, file *ast.SourceFile, call, callback *ast.Node) bool {
	if call == nil || !ast.IsCallExpression(call.Expression()) || !isExportOf(c, call.Expression(), "effect", "Effect", []string{"fn"}) {
		return false
	}
	d := report(c, callback, EK4301.With("{0} cannot be passed directly to {1} in this form. Effect.fn expects a body returning an Effect or a JavaScript generator."), nodeText(file, callback), calleeName(c, file, call))
	note(d, "Write an ordinary VibeLang function or arrow that returns withSpan(() => { ... }, name), using the same span name passed to Effect.fn. Calls inside the arrow run normally and the span is preserved.")
	return true
}
