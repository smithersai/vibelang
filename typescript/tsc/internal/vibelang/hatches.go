package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The boundary hatches (design D148) run plain TypeScript inside VibeLang:
//
//	const id = sync(crypto.randomUUID())                       // Effect.sync
//	const n = sync((text) => text.length, text)                // inputs fill its parameters
//	const tick = callback<number>((resume) => {                // Effect.callback
//	  const timer = setTimeout(() => resume(1), 10)
//	  return () => clearTimeout(timer)
//	})
//
// A hatch's first argument is TypeScript, not VibeLang: a call there does not
// run, so calling a .vibe function gives an inert Effect value for
// runPromise or runFork; throw, async, and await keep their JavaScript
// meaning; platform APIs are allowed (no EK4401, EK4402, or EK4403); and a
// runner may start a program (no EK1005). That TypeScript is self-contained
// (D229): it may use its own parameters and locals, globals, imports, and the
// file's error declarations, but no other binding of the .vibe file
// (EK4405). Values reach it as inputs, the arguments after the function, which
// fill its first parameters (D230). The inputs are VibeLang (D232). A
// throw or rejection that may fail is wrapped with Effect's own Effect.try
// or Effect.tryPromise, which replaced the try hatch (VIP-5).
//
// A hatch is a call whose callee is the prelude's sync or callback: the name,
// with no declaration in any scope around the call that shadows it.

// hatchNames are the prelude's hatches.
var hatchNames = map[string]bool{"sync": true, "callback": true}

// hatchOf returns the name of the hatch that call calls, or "".
func hatchOf(call *ast.Node) string {
	if call == nil || !ast.IsCallExpression(call) {
		return ""
	}
	callee := call.Expression()
	if !ast.IsIdentifier(callee) || !hatchNames[callee.Text()] {
		return ""
	}
	name := callee.Text()
	if !isVibeLangFile(ast.GetSourceFileOfNode(call)) || shadowed(call, name) {
		return ""
	}
	return name
}

// shadowed reports whether a scope around node declares name: a block, a
// function, or the module, whose locals the binder recorded.
func shadowed(node *ast.Node, name string) bool {
	for n := node; n != nil; n = n.Parent {
		if locals := n.Locals(); locals != nil {
			if _, ok := locals[name]; ok {
				return true
			}
		}
	}
	return false
}

// isHatchArgument reports whether node is a hatch's TypeScript: its first
// argument. The inputs after it are VibeLang (D232). The function that
// Effect.try or Effect.tryPromise wraps is TypeScript too (isWrappedCode).
func isHatchArgument(node *ast.Node) bool {
	if isWrappedCode(node) {
		return true
	}
	parent := node.Parent
	if parent == nil || !ast.IsCallExpression(parent) || parent.Expression() == node || hatchOf(parent) == "" {
		return false
	}
	arguments := parent.Arguments()
	return len(arguments) > 0 && arguments[0] == node
}

// isWrappedCode reports whether node is the code that Effect.try or
// Effect.tryPromise wraps, the wrappers that replaced the try hatch (VIP-5):
// a function literal that is the call's argument, or the try property of
// its options object. Like a hatch's, its body is TypeScript, where a throw
// or a rejection is JavaScript's, for the wrapper to catch.
func isWrappedCode(node *ast.Node) bool {
	if !ast.IsFunctionExpressionOrArrowFunction(node) {
		return false
	}
	call := node.Parent
	if call != nil && ast.IsPropertyAssignment(call) && ast.IsIdentifier(call.Name()) && call.Name().Text() == "try" && call.Initializer() == node {
		if object := call.Parent; object != nil && ast.IsObjectLiteralExpression(object) {
			call = object.Parent
			node = object
		}
	}
	if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) != 1 || call.Arguments()[0] != node {
		return false
	}
	callee := call.Expression()
	if !ast.IsPropertyAccessExpression(callee) || !ast.IsIdentifier(callee.Expression()) || callee.Expression().Text() != "Effect" {
		return false
	}
	name := callee.Name().Text()
	return (name == "try" || name == "tryPromise") && isVibeLangFile(ast.GetSourceFileOfNode(call))
}

// forEachHatchVibeLang calls visit with the arguments of call, a hatch, that are
// VibeLang: its inputs, every argument after the first (D232).
// It returns true when visit does, as ForEachChild would.
func forEachHatchVibeLang(call *ast.Node, visit func(node *ast.Node) bool) bool {
	arguments := call.Arguments()
	for i := 1; i < len(arguments); i++ {
		if visit(arguments[i]) {
			return true
		}
	}
	return false
}

// inHatch reports whether node is a hatch's first argument or inside one,
// where TypeScript, not VibeLang, gives the code its meaning.
func inHatch(node *ast.Node) bool {
	for n := node; n != nil && n.Parent != nil; n = n.Parent {
		if isHatchArgument(n) {
			return true
		}
	}
	return false
}

func init() {
	fileChecks = append(fileChecks, checkHatches)
	ls.RegisterCodeFixProvider(hatchInputFix)
	ls.RegisterQuickInfoHook(hatchQuickInfo)
}

// checkHatches reports EK4405 at each reference in a hatch's TypeScript to a binding
// that the .vibe file declares outside it (D229).
func checkHatches(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := hatchOf(node); name != "" {
			references := outsideReferences(c, hatchIsland(node))
			for _, reference := range references {
				d := report(c, reference, EK4405, reference.Text(), name)
				note(d, "Add a parameter for it and pass the value after the function, as in {0}(({1}) => …, {1}).", name, reference.Text())
			}
			if len(references) > 0 && takesFewerInputs(node) {
				// TypeScript then reports that the function fits no overload,
				// naming one it was never meant for; EK4405 explains the call.
				coverArgument(c, hatchIsland(node))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// takesFewerInputs reports whether call, a hatch, passes more inputs after
// its function than the function has parameters for.
func takesFewerInputs(call *ast.Node) bool {
	arguments := call.Arguments()
	island := hatchIsland(call)
	if island == nil || !ast.IsFunctionLike(island) {
		return false
	}
	return len(island.Parameters()) < len(arguments)-1
}

// hatchIsland returns the TypeScript of call, a hatch: its first argument, or
// nil.
func hatchIsland(call *ast.Node) *ast.Node {
	if arguments := call.Arguments(); len(arguments) > 0 {
		return arguments[0]
	}
	return nil
}

// outsideReferences returns the references in island, TypeScript, to bindings
// that its file declares outside island, in source order.
func outsideReferences(c *checker.Checker, island *ast.Node) []*ast.Node {
	if island == nil {
		return nil
	}
	var found []*ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case n.Kind == ast.KindTypeQuery:
			// `typeof value` here names a type, not a runtime capture (D229).
			// IsPartOfTypeNode deliberately treats its queried name as a value.
			return false
		case n.Kind == ast.KindShorthandPropertyAssignment:
			if declaredOutside(c.GetShorthandAssignmentValueSymbol(n), island) {
				found = append(found, n.Name())
			}
			return false
		case n.Kind == ast.KindIdentifier && isHatchValueReference(n):
			if declaredOutside(c.GetSymbolAtLocation(n), island) {
				found = append(found, n)
			}
		}
		return n.ForEachChild(visit)
	}
	visit(island)
	return found
}

// outsideNames returns the names of the bindings that outsideReferences finds
// in island, each once, in source order.
func outsideNames(c *checker.Checker, island *ast.Node) []string {
	var names []string
	seen := map[string]bool{}
	for _, reference := range outsideReferences(c, island) {
		if name := reference.Text(); !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}

// wrappedCall writes code, a plain expression, run through Effect's
// wrapper effect, Effect.try or Effect.tryPromise (VIP-5), for a note or a
// refactor that suggests it: try Effect.try(() => parse(text)). A mapper
// that is not "" becomes the wrapper's catch.
func wrappedCall(effect string, code string, mapper string) string {
	if mapper == "" {
		return "try Effect." + effect + "(() => " + code + ")"
	}
	return "try Effect." + effect + "({ try: () => " + code + ", catch: " + mapper + " })"
}

// boundaryCall writes call, a plain TypeScript call that EK4401 reports, as
// a run of Effect's wrapper effect, Effect.try or Effect.tryPromise, that
// compiles, for the note that suggests it. The wrapper's function is a plain
// callback, which runs no Effect, so each operand of call, its receiver or
// an argument, that runs an Effect or calls a .vibe function is bound first
// to a const named after the callee's parameter. A mapper that is not ""
// becomes the wrapper's catch.
//
//	shout(hello("VibeLang"))   const s = try hello("VibeLang"); try Effect.try(() => shout(s))
//	sortTitles(titles)         try Effect.try(() => sortTitles(titles))
func boundaryCall(c *checker.Checker, file *ast.SourceFile, effect string, call *ast.Node, mapper string) string {
	a := analyzerFor(c)
	type input struct {
		node        *ast.Node // the operand the const stands for
		pos         int
		param, text string
	}
	var operands []input
	callee := ast.SkipParentheses(call.Expression())
	if ast.IsPropertyAccessExpression(callee) || ast.IsElementAccessExpression(callee) {
		operands = append(operands, input{node: callee.Expression(), param: receiverParameterName(callee.Expression())})
	}
	for i, argument := range call.Arguments() {
		if ast.IsSpreadElement(argument) {
			argument = argument.Expression()
		}
		operands = append(operands, input{node: argument, param: argumentParameterName(c, call, i)})
	}
	var inputs []input
	for _, operand := range operands {
		if a.runsVibeLang(operand.node) {
			operand.pos, operand.text = nodeStart(file, operand.node), nodeText(file, operand.node)
			inputs = append(inputs, operand)
		}
	}
	replaced := func(n *ast.Node) bool {
		return slices.ContainsFunc(inputs, func(in input) bool { return in.node.Pos() <= n.Pos() && n.End() <= in.node.End() })
	}
	// The names the rest of the call reads, which a const must not shadow.
	taken := map[string]bool{}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if replaced(n) {
			return false
		}
		if ast.IsIdentifier(n) {
			taken[n.Text()] = true
		}
		return n.ForEachChild(visit)
	}
	visit(call)
	// The consts join the enclosing function's scope, so they must not
	// shadow or redeclare a name written anywhere in it.
	if fn := enclosingFunction(call); fn != nil {
		var names func(n *ast.Node) bool
		names = func(n *ast.Node) bool {
			if ast.IsIdentifier(n) {
				taken[n.Text()] = true
			}
			return n.ForEachChild(names)
		}
		fn.ForEachChild(names)
	}
	for i := range inputs {
		base, name := inputs[i].param, inputs[i].param
		for n := 2; taken[name]; n++ {
			name = base + strconv.Itoa(n)
		}
		taken[name] = true
		inputs[i].param = name
	}
	start := nodeStart(file, call)
	text := file.Text()[start:call.End()]
	for i := len(inputs) - 1; i >= 0; i-- {
		in := inputs[i]
		text = text[:in.pos-start] + in.param + text[in.node.End()-start:]
	}
	var consts []string
	for _, in := range inputs {
		value := in.text
		if operand := ast.SkipParentheses(in.node); isInvocation(operand) && a.performs(operand) {
			value = "try " + value
		}
		consts = append(consts, "const "+in.param+" = "+value+"; ")
	}
	return strings.Join(consts, "") + wrappedCall(effect, text, mapper)
}

// runsVibeLang reports whether evaluating node, an expression, runs an
// Effect, looks up a service, reads an Effect value, or calls a .vibe
// function, outside the functions it defines.
func (a *analyzer) runsVibeLang(node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if isInvocation(n) && (a.performs(n) || a.callsVibeLangFunction(n) || ast.IsCallExpression(n) && isEffectValueCall(a.checker, n)) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(node)
}

// receiverParameterName names the parameter that stands for receiver, a
// call's receiver passed to a hatch as an input: its own name, or the name of
// the member a call or an access reads, as shelf for Todos.shelf().
func receiverParameterName(receiver *ast.Node) string {
	receiver = ast.SkipParentheses(receiver)
	if ast.IsCallExpression(receiver) {
		receiver = ast.SkipParentheses(receiver.Expression())
	}
	switch {
	case ast.IsIdentifier(receiver):
		return receiver.Text()
	case ast.IsPropertyAccessExpression(receiver) && ast.IsIdentifier(receiver.Name()):
		return receiver.Name().Text()
	}
	return "receiver"
}

// argumentParameterName names the parameter that stands for call's argument
// at index, passed to a hatch as an input: the callee's parameter there, as s
// for shout(s: string), or value.
func argumentParameterName(c *checker.Checker, call *ast.Node, index int) string {
	declaration := signatureDeclaration(c, call)
	if declaration == nil {
		return "value"
	}
	var parameters []*ast.Node
	for _, parameter := range declaration.Parameters() {
		if name := parameter.Name(); !ast.IsIdentifier(name) || name.Text() != "this" {
			parameters = append(parameters, parameter)
		}
	}
	if index >= len(parameters) {
		if len(parameters) == 0 || parameters[len(parameters)-1].AsParameterDeclaration().DotDotDotToken == nil {
			return "value"
		}
		index = len(parameters) - 1
	}
	if name := parameters[index].Name(); ast.IsIdentifier(name) {
		return name.Text()
	}
	return "value"
}

// isHatchValueReference reports whether id, an identifier, reads a value: not a
// declaration's name, a type, or a member name after a dot.
func isHatchValueReference(id *ast.Node) bool {
	// A binding element's property name, `extra` in `const { extra: picked } = item`,
	// names the property it reads, not a binding.
	return id.Parent != nil && !ast.IsDeclarationName(id) && !ast.IsPartOfTypeNode(id) && !ast.IsRightSideOfQualifiedNameOrPropertyAccess(id) &&
		!(id.Parent.Kind == ast.KindBindingElement && id.Parent.PropertyName() == id)
}

// declaredOutside reports whether symbol is a value that island's file
// declares outside island. Imports, globals, prelude names, and the file's
// error declarations are not: an error declaration is a plain class, and
// failing with one is what a hatch most often needs from its file (D229). An
// .vibe file is always a module, so another one's values arrive by import.
func declaredOutside(symbol *ast.Symbol, island *ast.Node) bool {
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias != 0 || symbol.Flags()&ast.SymbolFlagsValue == 0 {
		return false
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil {
		if len(symbol.Declarations()) == 0 {
			return false
		}
		declaration = symbol.Declarations()[0]
	}
	if ast.GetSourceFileOfNode(declaration) != ast.GetSourceFileOfNode(island) || isTaggedErrorClass(declaration) {
		return false
	}
	for n := declaration; n != nil; n = n.Parent {
		if n == island {
			return false
		}
	}
	return true
}

// isTaggedErrorClass reports whether declaration is a class that extends
// TaggedError(…), as an error declaration does.
func isTaggedErrorClass(declaration *ast.Node) bool {
	if !ast.IsClassDeclaration(declaration) && !ast.IsClassExpression(declaration) {
		return false
	}
	heritage := ast.GetClassExtendsHeritageElement(declaration)
	if heritage == nil || !ast.IsCallExpression(heritage.Expression()) {
		return false
	}
	callee := heritage.Expression().Expression()
	switch {
	case ast.IsIdentifier(callee):
		return callee.Text() == "TaggedError"
	case ast.IsPropertyAccessExpression(callee):
		return callee.Name().Text() == "TaggedError"
	}
	return false
}

// hasProperty reports whether object, an object literal, has a property
// named name.
func hasProperty(object *ast.Node, name string) bool {
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		if n := property.Name(); n != nil && ast.IsIdentifier(n) && n.Text() == name {
			return true
		}
	}
	return false
}

// hatchForm is what the lowering emits for a sync hatch.
type hatchForm struct {
	effect string // "sync" or "promise"
	value  bool   // sync(expression): wrap it in () =>
	signal bool   // the overload gives an async function the AbortSignal after its inputs (D230)

	// adapter says the type cannot tell a promise from a plain value, so the
	// runtime's sync decides for each value the function returns.
	adapter bool
}

// hatchFormOf returns the form of call, a sync hatch. The overload the
// checker selected tells a function from a value, by the name the runtime
// gives its first parameter (evaluate or value), and whether an async
// function gets the AbortSignal after its inputs (takesSignal). The function
// itself decides between sync and async (D232): an async function, or one
// that returns a promise, is Effect.promise.
func hatchFormOf(c *checker.Checker, call *ast.Node) (hatchForm, bool) {
	name := hatchOf(call)
	if name != "sync" {
		return hatchForm{}, false
	}
	signature := c.GetResolvedSignature(call)
	if signature == nil || signature.Declaration() == nil || len(call.Arguments()) == 0 {
		return hatchForm{}, false
	}
	parameters := signature.Declaration().Parameters()
	if len(parameters) == 0 || !ast.IsIdentifier(parameters[0].Name()) {
		return hatchForm{}, false
	}
	var form hatchForm
	switch parameters[0].Name().Text() {
	case "evaluate":
	case "value":
		form.value = true
	default:
		return hatchForm{}, false
	}
	form.signal = takesSignal(parameters[0])
	form.effect = name
	switch hatchPromiseOf(c, call.Arguments()[0], form.value) {
	case alwaysPromise:
		form.effect = "promise"
	case maybePromise:
		form.adapter = true
	}
	return form, true
}

// takesSignal reports whether parameter, the evaluate parameter of the
// overload the checker selected, gives the function the AbortSignal after its
// inputs: evaluate: (...args: [...Args, AbortSignal]) => PromiseLike<R>.
// TypeScript selects that overload only when the function's parameter after
// its inputs, if it has one, can take an AbortSignal; the other overload
// calls the function with its inputs alone.
func takesSignal(parameter *ast.Node) bool {
	fn := parameter.Type()
	if fn == nil || !ast.IsFunctionTypeNode(fn) || len(fn.Parameters()) == 0 {
		return false
	}
	rest := fn.Parameters()[len(fn.Parameters())-1]
	if rest.AsParameterDeclaration().DotDotDotToken == nil || rest.Type() == nil || !ast.IsTupleTypeNode(rest.Type()) {
		return false
	}
	elements := rest.Type().AsTupleTypeNode().Elements.Nodes
	if len(elements) == 0 {
		return false
	}
	last := elements[len(elements)-1]
	return ast.IsTypeReferenceNode(last) && ast.IsIdentifier(last.AsTypeReferenceNode().TypeName) && last.AsTypeReferenceNode().TypeName.Text() == "AbortSignal"
}

// bindsExactly reports whether binding argument's inputs gives Effect.promise
// the evaluate $asyncHatch would make of it when the overload passes a
// signal: argument is an arrow function, which has no arguments object, with
// no rest parameter. The bound function's length then counts a parameter for
// the signal exactly when $asyncHatch would pass one, and the undefined that
// Effect passes otherwise fills no parameter, or a defaulted one.
func bindsExactly(argument *ast.Node) bool {
	argument = ast.SkipParentheses(argument)
	if !ast.IsArrowFunction(argument) {
		return false
	}
	for _, parameter := range argument.Parameters() {
		if parameter.AsParameterDeclaration().DotDotDotToken != nil {
			return false
		}
	}
	return true
}

// promiseness is what a type says about whether its values are promises,
// by the test the runtime's hatches apply to a value: an object or function
// whose then is a function.
type promiseness uint8

const (
	neverPromise  promiseness = iota // no value is a promise
	alwaysPromise                    // every value is a promise
	maybePromise                     // some values may be promises and others not
)

// hatchPromiseOf says whether argument, a hatch's first argument, gives a
// promise: an async function, or the values its signatures return, or, for
// a value, its own type. Effect.sync and Effect.promise are chosen only
// where the type proves which applies; otherwise the runtime's hatch, which
// tests each value, decides (maybePromise).
func hatchPromiseOf(c *checker.Checker, argument *ast.Node, value bool) promiseness {
	argument = ast.SkipParentheses(argument)
	if value {
		return promisenessOf(c, c.GetTypeAtLocation(argument))
	}
	if ast.IsFunctionExpressionOrArrowFunction(argument) && ast.GetFunctionFlags(argument)&ast.FunctionFlagsAsync != 0 {
		return alwaysPromise
	}
	var kinds []promiseness
	for _, signature := range c.GetSignaturesOfType(c.GetTypeAtLocation(argument), checker.SignatureKindCall) {
		kinds = append(kinds, promisenessOf(c, c.GetReturnTypeOfSignature(signature)))
	}
	return joinPromiseness(kinds)
}

// promisenessOf says whether the values of t are promises. A union is a
// promise when each member is, and a type is one when its then is a
// function on every value; a then that is data, such as { then: 7 }, is not
// one. any and unknown are not either, so a function returning any, such as
// JSON.parse, stays synchronous (D232).
func promisenessOf(c *checker.Checker, t *checker.Type) promiseness {
	switch {
	case t == nil || t.Flags()&checker.TypeFlagsAnyOrUnknown != 0:
		return neverPromise
	case t.Flags()&checker.TypeFlagsUnion != 0:
		var kinds []promiseness
		for _, member := range t.Types() {
			kinds = append(kinds, promisenessOf(c, member))
		}
		return joinPromiseness(kinds)
	}
	then := c.GetPropertyOfType(t, "then")
	if then == nil {
		return neverPromise
	}
	thenType := c.GetTypeOfSymbol(then)
	if thenType.Flags()&checker.TypeFlagsAnyOrUnknown != 0 {
		return maybePromise
	}
	var kinds []promiseness
	for _, member := range unionMembers(thenType) {
		if len(c.GetSignaturesOfType(member, checker.SignatureKindCall)) > 0 {
			kinds = append(kinds, alwaysPromise)
		} else {
			kinds = append(kinds, neverPromise)
		}
	}
	kind := joinPromiseness(kinds)
	if kind == alwaysPromise && then.Flags()&ast.SymbolFlagsOptional != 0 {
		return maybePromise
	}
	return kind
}

// joinPromiseness says what values of any of kinds are: neverPromise for
// none.
func joinPromiseness(kinds []promiseness) promiseness {
	if len(kinds) == 0 {
		return neverPromise
	}
	for _, kind := range kinds[1:] {
		if kind != kinds[0] {
			return maybePromise
		}
	}
	return kinds[0]
}

// visitHatchCall lowers a sync hatch to Effect's function:
//
//	sync(() => f())                    Effect.sync(() => f())
//	sync(fetch)                        Effect.promise(fetch) when fetch returns a promise
//	sync((n) => n * 2, count)          Effect.sync(((n) => n * 2).bind(undefined, count))
//
// The first argument stays TypeScript: its calls do not run. The inputs are
// VibeLang, lowered where the call stands, so a call among the
// inputs runs before the hatch starts. bind fills the function's first
// parameters with the inputs; Effect then passes the signal, if any, after
// them. An async function is called through the runtime's $asyncHatch unless
// binding is exact (bindsExactly):
//
//	sync(count, 1, 2)                  Effect.promise(runtime.$asyncHatch(count, false, 1, 2))
//
// Effect.promise passes the signal to whatever parameter the bound function
// has left and undefined when it has none, which a rest parameter collects.
// $asyncHatch gives the function exactly its inputs, then the signal when
// the overload passes one (hatchForm.signal) and the function declares a
// parameter for it: the rule sync follows when called as a value. The
// call itself returns an Effect, so it runs as yield* where calls run.
func (tx *lowering) visitHatchCall(node *ast.Node) *ast.Node {
	form := tx.plan.hatches[node]
	f := tx.Factory()
	arguments := node.Arguments()
	saved, savedPlain := tx.inEffect, tx.plain
	tx.inEffect, tx.plain = false, false
	body := tx.Visitor().VisitNode(arguments[0])
	tx.inEffect, tx.plain = saved, savedPlain
	inputs := []*ast.Node{f.NewIdentifier("undefined")}
	for _, input := range arguments[1:] {
		inputs = append(inputs, tx.Visitor().VisitNode(input))
	}
	// The runtime's adapter takes the function and the inputs as written.
	if form.adapter {
		return tx.adapterHatchCall(node, form, body, inputs[1:])
	}
	async := form.effect == "promise"
	switch {
	case form.value:
		body = tx.generated(f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList(nil), nil /*returnType*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), body))
	case async && !(form.signal && bindsExactly(arguments[0])):
		signal := f.NewKeywordExpression(ast.KindFalseKeyword)
		if form.signal {
			signal = f.NewKeywordExpression(ast.KindTrueKeyword)
		}
		hatchArguments := append([]*ast.Node{body, signal}, inputs[1:]...)
		body = f.NewCallExpression(tx.runtimeMember("$asyncHatch"), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(hatchArguments), ast.NodeFlagsNone)
	case len(inputs) > 1:
		bind := f.NewPropertyAccessExpression(f.NewParenthesizedExpression(body), nil /*questionDotToken*/, f.NewIdentifier("bind"), ast.NodeFlagsNone)
		body = f.NewCallExpression(bind, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(inputs), ast.NodeFlagsNone)
	}
	effectArguments := []*ast.Node{body}
	callee := f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier(form.effect), ast.NodeFlagsNone)
	lowered := f.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(effectArguments), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	if tx.inEffect && tx.plan.runsCall(node) {
		run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), lowered)
		tx.EmitContext().SetOriginal(run, node)
		return run
	}
	return lowered
}

// hatchQuickInfo describes a hatch on a hover of its name.
func hatchQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	call := node.Parent
	if call == nil || !ast.IsCallExpression(call) || call.Expression() != node {
		return "", ""
	}
	name := hatchOf(call)
	if name == "" {
		return "", ""
	}
	paragraph := "An escape hatch: its first argument is self-contained TypeScript (D229)."
	if inputs := hatchInputs(call); len(inputs) > 0 {
		var names []string
		for _, input := range inputs {
			names = append(names, "`"+scanner.GetSourceTextOfNodeFromSourceFile(ast.GetSourceFileOfNode(call), input, false /*includeTrivia*/)+"`")
		}
		paragraph += " Inputs, which fill its first parameters: " + strings.Join(names, ", ") + "."
	}
	return "", paragraph
}

// adapterHatchCall lowers node, a sync hatch whose function or value may or
// may not give a promise, to the runtime's hatch, which awaits a value whose
// then is a function and returns any other value (D232):
//
//	sync((flag) => flag ? Promise.resolve(1) : 1, f)   runtime.sync((flag) => …, f)
//
// body is the lowered function, or the value; the inputs follow it as the
// source wrote them.
func (tx *lowering) adapterHatchCall(node *ast.Node, form hatchForm, body *ast.Node, inputs []*ast.Node) *ast.Node {
	f := tx.Factory()
	if form.value {
		body = tx.generated(f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList(nil), nil /*returnType*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), body))
	}
	arguments := append([]*ast.Node{body}, inputs...)
	lowered := f.NewCallExpression(tx.runtimeMember(form.effect), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(lowered, node)
	lowered.Loc = node.Loc
	if tx.inEffect && tx.plan.runsCall(node) {
		run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), lowered)
		tx.EmitContext().SetOriginal(run, node)
		return run
	}
	return lowered
}

// hatchInputs returns the inputs of call, a hatch: the arguments after its
// function.
func hatchInputs(call *ast.Node) []*ast.Node {
	if arguments := call.Arguments(); len(arguments) > 1 {
		return arguments[1:]
	}
	return nil
}

// hatchInputFix is EK4405's quick fix: it makes every binding the hatch's
// TypeScript reads from outside an input. It adds a parameter for each after
// the parameters that take the existing inputs, and passes each value after
// the existing inputs.
var hatchInputFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4405.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		file := fix.SourceFile
		var call *ast.Node
		for n := astnav.GetTouchingPropertyName(file, fix.Span.Pos()); n != nil; n = n.Parent {
			if isHatchArgument(n) {
				call = n.Parent
				break
			}
		}
		if call == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
		defer done()
		names := outsideNames(c, hatchIsland(call))
		if len(names) == 0 {
			return nil, nil
		}
		list := strings.Join(names, ", ")
		edits := hatchInputEdits(c, fix, file, call, list)
		arguments := call.Arguments()
		edits = append(edits, edit(fix, file, arguments[len(arguments)-1].End(), ", "+list))
		description := "Pass " + list + " as an input"
		if len(names) > 1 {
			description += "s"
		}
		return []*ls.CodeAction{{Description: description, Changes: edits}}, nil
	},
}

// hatchInputEdits adds parameters named list to the hatch's TypeScript, or,
// for an expression, makes it a function of them.
func hatchInputEdits(c *checker.Checker, fix *ls.CodeFixContext, file *ast.SourceFile, call *ast.Node, list string) []*lsproto.TextEdit {
	rangeOf := func(start, end int) lsproto.Range { return fix.LS.RangeOf(file, core.NewTextRange(start, end)) }
	island := call.Arguments()[0]
	text := file.Text()
	start := scanner.SkipTrivia(text, island.Pos())
	function := ast.SkipParentheses(island)
	if !ast.IsFunctionExpressionOrArrowFunction(function) {
		replacement := "(" + list + ") => " + text[start:island.End()]
		if len(c.GetSignaturesOfType(c.GetTypeAtLocation(island), checker.SignatureKindCall)) > 0 {
			replacement += "()" // a function value: call it
		}
		return []*lsproto.TextEdit{{NewText: replacement, Range: rangeOf(start, island.End())}}
	}
	parameters := function.Parameters()
	existing := len(hatchInputs(call))
	if len(parameters) > 0 && !parenthesized(text, parameters[0].Pos()) {
		// x => …: a lone parameter without parentheses.
		first := scanner.SkipTrivia(text, parameters[0].Pos())
		inner := list + ", " + text[first:parameters[0].End()]
		if existing > 0 {
			inner = text[first:parameters[0].End()] + ", " + list
		}
		return []*lsproto.TextEdit{{NewText: "(" + inner + ")", Range: rangeOf(first, parameters[0].End())}}
	}
	switch {
	case existing < len(parameters):
		at := scanner.SkipTrivia(text, parameters[existing].Pos())
		return []*lsproto.TextEdit{{NewText: list + ", ", Range: rangeOf(at, at)}}
	case len(parameters) > 0:
		at := parameters[len(parameters)-1].End()
		return []*lsproto.TextEdit{{NewText: ", " + list, Range: rangeOf(at, at)}}
	default:
		open := strings.IndexByte(text[function.Pos():function.End()], '(')
		if open < 0 {
			return nil
		}
		at := function.Pos() + open + 1
		return []*lsproto.TextEdit{{NewText: list, Range: rangeOf(at, at)}}
	}
}

// parenthesized reports whether the parameter at pos follows an open paren.
func parenthesized(text string, pos int) bool {
	for i := pos - 1; i >= 0; i-- {
		switch text[i] {
		case ' ', '\t', '\n', '\r':
			continue
		case '(':
			return true
		}
		return false
	}
	return false
}

// edit inserts text at pos.
func edit(fix *ls.CodeFixContext, file *ast.SourceFile, pos int, text string) *lsproto.TextEdit {
	return &lsproto.TextEdit{NewText: text, Range: fix.LS.RangeOf(file, core.NewTextRange(pos, pos))}
}
