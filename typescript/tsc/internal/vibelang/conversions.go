package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A function value, as opposed to a lambda written in place, is passed in the
// form its position expects (Chapter 13, "Function values"):
//
//	Effect.retry(flaky, policy)            // flaky: () => Effect<A, E, R>    -> Effect.suspend(flaky)
//	Effect.all(stores.map(makeSync))       // Array<() => Effect<A, E, R>>    -> $programs(...)
//	ids.map(findName)                      // findName is an Effect function  -> EK4301
//
// Where the overload candidate under check declares an Effect, a function
// with no parameters that returns an Effect converts to a program (D7). Where
// it declares an iterable or a record of Effects, an iterable or a record of
// such functions converts element by element (D49). Where it declares a plain
// function, an Effect function is EK4301 (D430, D500): it is passed as itself,
// never as its plain variant. As with
// lambdas, each candidate decides once, and the candidate overload resolution
// selects decides what the value compiles to.
type conversion uint8

const (
	convertNone        conversion = iota
	convertProgram                // Effect.suspend(value)
	convertSyncProgram            // Effect.sync(value), a plain zero-argument function
	convertPrograms               // $programs(value), an array or record of programs
	convertRejected               // a function that can pause where a plain function is expected
	convertByName                 // an expression that runs an Effect, passed as a program that runs it (D147)
)

// valueState records, for one argument expression, the conversion each
// candidate asked for.
type valueState struct {
	byCandidate map[candidateKey]conversion
	first       conversion // what the first candidate to check the value asked for
	checked     bool       // a candidate has checked the value
	types       map[candidateKey]*checker.Type
}

// expressionType gives an argument expression the type of the conversion the
// candidate under check asks for, or its contextual program field (D265).
func expressionType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	// A keyword operand is a program by syntax, whatever its type (D322):
	// decided before any position or type is read (keywords.go).
	if t != nil && mayBeKeywordOperand(node) && !analyzerFor(c).valueTyping[node] {
		if program, ok := analyzerFor(c).keywordOperandType(node, t); ok {
			return program
		}
	}
	if !mayConvert(c, node, t) || analyzerFor(c).valueTyping[node] || analyzerFor(c).classifying[node] {
		return t
	}
	call, path := ownerCall(node)
	if !isVibeLangFile(ast.GetSourceFileOfNode(node)) || inHatch(node) {
		return t
	}
	a := analyzerFor(c)
	if call != nil && len(a.current[call]) == 0 && !a.resolving[call] {
		// Asked for an argument's type before its call is resolved, as an
		// editor's hover on the argument asks: resolve the call first. Its
		// resolution checks this argument under each candidate and decides
		// its conversion there. Classifying it below would otherwise resolve
		// the call from inside the classification, where this argument reads
		// as its plain value, and cache a signature inferred from that value,
		// such as Effect.timeout's Effect<unknown, unknown, unknown> for a
		// call passed by name.
		a.candidateOf(call)
	}
	// Classifying a field reads its contextual type. For an object literal
	// with a union context, the checker discriminates the union by the
	// literal's members and checks a shorthand member's value, which asks for
	// this node's type again; the inner check sees the plain value (S21-2,
	// S22-1).
	a.classifying[node] = true
	key, position, ok := a.valuePositionOf(call, path, node, t)
	delete(a.classifying, node)
	if !ok {
		return t
	}
	s := a.conversions[node]
	if s == nil {
		s = &valueState{byCandidate: map[candidateKey]conversion{}, types: map[candidateKey]*checker.Type{}}
		a.conversions[node] = s
	}
	if conv, ok := s.byCandidate[key]; ok {
		switch conv {
		case convertByName:
			// Context can become concrete after generic inference. A field
			// that now holds an Effect already has its program type (D265).
			if isEffectType(c, t) && holdsProgram(c, node) {
				s.byCandidate[key], s.types[key] = convertNone, t
				return t
			}
			// The program's type follows t, the type of the expression's value
			// in this check: a check that skips a generic call, as an inference
			// pass does, sees a placeholder never that a later check replaces,
			// and that must reach inference unwrapped so it infers nothing.
			if program := a.byNameType(node, a.valueTypeOf(node, t)); program != nil {
				return program
			}
		case convertProgram, convertSyncProgram, convertPrograms, convertRejected:
			return s.types[key]
		}
		return t
	}
	conv, converted := a.convert(node, t, position)
	s.byCandidate[key] = conv
	s.types[key] = converted
	if !s.checked {
		s.first, s.checked = conv, true
	}
	if conv == convertRejected && call != nil {
		a.reject(call, key)
	}
	return converted
}

// valuePositionOf classifies node's position for expressionType: the
// candidate's parameter when a call owns node, or else a contextual program
// field (D265). It reports false where nothing converts node.
func (a *analyzer) valuePositionOf(call *ast.Node, path []pathStep, node *ast.Node, t *checker.Type) (candidateKey, valuePosition, bool) {
	var key candidateKey
	var position valuePosition
	if call != nil {
		signature := a.candidateOf(call)
		if signature == nil {
			return key, position, false
		}
		return keyOf(signature), a.classifyValuePosition(call, signature, path, node, t), true
	}
	// D265 supplies a program position for object fields without an
	// enclosing call. An assertion also supplies a contextual Effect type,
	// but its operand is a value: the deferred assertion check builds the
	// delayed program type once the surrounding by-name position is known.
	outer := ast.WalkUpParenthesizedExpressions(node)
	if outer.Parent == nil || !ast.IsPropertyAssignment(outer.Parent) && !ast.IsShorthandPropertyAssignment(outer.Parent) {
		return key, position, false
	}
	position.expectation = a.classify(a.contextualTypes(node))
	return key, position, position.program
}

// mayConvert is the cheap test that runs on every expression: node is an
// argument, an array element, or a property value, it is not a lambda, whose
// form forms.go decides, and either its type is a function or an object or it
// evaluates a call in a function the lowering turns into an Effect, so it may
// be passed by name (D147).
func mayConvert(c *checker.Checker, node *ast.Node, t *checker.Type) bool {
	switch node.Kind {
	case ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindParenthesizedExpression:
		return false
	}
	parent := node.Parent
	if parent == nil || t == nil {
		return false
	}
	switch parent.Kind {
	case ast.KindCallExpression, ast.KindNewExpression:
		if parent.Expression() == node {
			return false
		}
	case ast.KindArrayLiteralExpression, ast.KindParenthesizedExpression:
	case ast.KindShorthandPropertyAssignment:
		if parent.Name() != node {
			return false
		}
	case ast.KindPropertyAssignment:
		if parent.Initializer() != node {
			return false
		}
	default:
		return false
	}
	if t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		return true
	}
	return mayRunByName(node)
}

// valuePosition is what an argument position expects of a value.
type valuePosition struct {
	expectation             // the value itself
	elements    expectation // the elements or property values of a container
}

func (a *analyzer) classifyValuePosition(call *ast.Node, signature *checker.Signature, path []pathStep, node *ast.Node, t *checker.Type) valuePosition {
	expected := a.expectedAt(call, signature, path, node)
	position := valuePosition{expectation: a.classify(expected)}
	if position.plainFn && !position.effectFn && a.takenAsData(expected, t) {
		position.plainFn = false
	}
	if !position.any() {
		elements := a.stepInto(expected, pathStep{element: true})
		elements = append(elements, a.stepInto(expected, pathStep{property: "\x00"})...) // string index signatures
		position.elements = a.classify(elements)
	}
	return position
}

// takenAsData reports whether t is assignable to a member of the expected
// types that has no call signature, and to none that has one: the target
// takes the value as data, as alchemy's ResourceClassLike | Platform takes a
// resource class, so no call signature of the target reaches it (D430).
func (a *analyzer) takenAsData(expected []*checker.Type, t *checker.Type) bool {
	if t == nil {
		return false
	}
	data, callable := false, false
	var visit func(e *checker.Type, depth int)
	visit = func(e *checker.Type, depth int) {
		e = unwrapSubstitution(e)
		if depth > 4 {
			return
		}
		if e.Flags()&checker.TypeFlagsUnion != 0 {
			for _, member := range e.Types() {
				visit(member, depth+1)
			}
			return
		}
		if e.Flags()&checker.TypeFlagsObject == 0 || !a.checker.IsTypeAssignableTo(t, e) {
			return
		}
		if len(a.checker.GetSignaturesOfType(e, checker.SignatureKindCall)) == 0 {
			data = true
		} else {
			callable = true
		}
	}
	for _, e := range expected {
		visit(e, 0)
	}
	return data && !callable
}

// convert decides what value of type t converts to at a position.
func (a *analyzer) convert(node *ast.Node, t *checker.Type, position valuePosition) (conversion, *checker.Type) {
	// A try operation's operand elements are Effects already, callable ones
	// included (VIP-18): only by-name deferral applies, never function adoption.
	if call, _ := ownerCall(node); tryOperationName(call) != "" && (tryOperationEffectType(a.checker, t) || tryOperationArrayType(a.checker, t)) {
		return a.convertByName(node, t, position)
	}
	switch {
	case position.program && !(position.effectFn || position.plainFn):
		if effect := a.programOf(t); effect != nil {
			return convertProgram, effect
		}
	case position.program:
		// A function or an Effect (D39): a function with no parameters that
		// returns an Effect can pause, so it converts to a program.
		if effect := a.programOf(t); effect != nil {
			return convertProgram, effect
		}
	case position.plainFn && !position.effectFn:
		fn := esFunctionOf(a.checker, node)
		switch {
		case fn == nil:
			// A function value known only by its type has the form its type
			// gives (D492, D511): one that returns an Effect, or may (D512),
			// is an Effect function's value.
			if mayReturnEffect(a.checker, t) {
				return convertRejected, t
			}
			// A trusted value that lists failures: its receiver would get a
			// listed failure as an exception, a defect (D514).
			if failures, ok := trustedValueFailures(a.checker, node); ok && len(failures) > 0 {
				return convertRejected, t
			}
		case a.isFactory(fn):
			return convertRejected, t
		case isProducer(fn):
			// Calling a producer runs none of it: it is a plain function.
		case a.isPlainFunction(fn) && !a.isSplittable(fn):
			// Annotated with a plain return type: the function itself is
			// plain, but as a value it has its type's form, so one whose
			// return type is an Effect, as pick(p: number!!): infer _ has, is
			// an Effect function's value (D511).
			if mayReturnEffect(a.checker, t) {
				return convertRejected, t
			}
		case a.isEffect(fn) || a.isPlainFunction(fn):
			return convertRejected, t
		}
	case position.elements.program:
		if converted := a.programsOf(t); converted != nil {
			return convertPrograms, converted
		}
	}
	if position.program && !position.plainFn && !position.effectFn {
		signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall)
		if len(signatures) == 1 && signatures[0].MinArgumentCount() == 0 && len(signatures[0].TypeParameters()) == 0 {
			returned := a.checker.GetReturnTypeOfSignature(signatures[0])
			// A function that already returns a program, such as
			// () => (throw failure), is the program's own form; Effect.sync
			// would nest it (Smithers twin gateway).
			if a.effectInterface != nil && !isEffectType(a.checker, returned) {
				never := a.checker.GetNeverType()
				return convertSyncProgram, a.checker.NewTypeReference(a.effectInterface, []*checker.Type{returned, never, never})
			}
		}
	}
	return a.convertByName(node, t, position)
}

// convertByName passes an expression that runs an Effect by name where a
// program is expected.
func (a *analyzer) convertByName(node *ast.Node, t *checker.Type, position valuePosition) (conversion, *checker.Type) {
	// An expression that runs an Effect where a program is expected is passed
	// by name (D147): fork(fetchReport()) passes fetchReport() as a program,
	// as if written () => fetchReport(), and runs nothing at the call site. A
	// held program keeps its meaning, including in a compound expression.
	if position.program && a.pauses(node) {
		// Inference can pass a placeholder never for a skipped generic call.
		// Inspect its actual value before choosing by-name conversion. A
		// running call still passes its outer program when A is an Effect;
		// the success value must never select an unwrapped reading (D147).
		value := a.valueTypeOf(node, t)
		if isEffectType(a.checker, value) && !inLowerableBody(byNameSubject(node)) {
			// Library calls at module top level keep their raw Effect type;
			// there is no unwrapped success reading to pass by name again.
			return convertNone, t
		}
		// D265/D269 hold an initializer call, not the calls in a compound
		// initializer. Delay that whole expression under D147 so an absent
		// conditional arm becomes a success value, not a missing program.
		if !isInvocation(node) || !holdsProgram(a.checker, node) {
			if program := a.byNameType(node, value); program != nil {
				return convertByName, program
			}
		}
	}
	return convertNone, t
}

// mayReturnEffect reports whether t, a function value's type, has a call
// signature whose return type is definitely an Effect or a union with such a
// member: a value of the Effect form, or one that may return a program, which
// no plain function type accepts (D430, D511, D512).
func mayReturnEffect(c *checker.Checker, t *checker.Type) bool {
	if t == nil || isPlaceholderNever(t) {
		return false
	}
	for _, signature := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		returned := c.GetReturnTypeOfSignature(signature)
		if isEffectType(c, returned) {
			return true
		}
		if returned.Flags()&checker.TypeFlagsUnion != 0 {
			for _, member := range returned.Types() {
				if isEffectType(c, member) {
					return true // it may return a program (D512)
				}
			}
		}
	}
	return false
}

// isPlaceholderNever reports whether t is the never that the checker gives a
// generic call it skips during an inference pass, which infers nothing.
func isPlaceholderNever(t *checker.Type) bool {
	return t.Flags()&checker.TypeFlagsNever != 0 && t.ObjectFlags()&checker.ObjectFlagsNonInferrableType != 0
}

// valueTypeOf returns t, the type of node's value in the check in progress,
// or node's own type when t is the placeholder never of an inference pass
// that skipped a generic call in node. A by-name argument must infer the
// callee's type parameters in that pass: a placeholder infers nothing, so a
// type parameter with a default, as in Effect.forkScoped's
// <Arg extends Effect | Options = Options>, would take the default.
func (a *analyzer) valueTypeOf(node *ast.Node, t *checker.Type) *checker.Type {
	node = byNameSubject(node)
	if !isPlaceholderNever(t) || a.valueTyping[node] {
		return t
	}
	a.valueTyping[node] = true
	defer delete(a.valueTyping, node)
	return a.checker.GetTypeAtLocation(node)
}

// mayRunByName is the cheap test for an expression of any type that it may be
// passed by name: it evaluates a call, and it sits in the body of a function
// the lowering can turn into an Effect, where calls run, or at a module's top
// level, where a call to a plain function runs inline. A pipe's topic passes
// the pipe's left side (pipes.go).
func mayRunByName(node *ast.Node) bool {
	node = byNameSubject(node)
	return containsCall(node) && (inLowerableBody(node) || atTopLevel(node))
}

// atTopLevel reports whether a module's top level evaluates node, not a
// function or class inside it.
func atTopLevel(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindSourceFile {
			return isVibeLangFile(n.AsSourceFile())
		}
	}
	return false
}

// containsCall reports whether node is or contains a call that node itself
// evaluates, not one in a nested function.
func containsCall(node *ast.Node) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		return isInvocation(n) || n.ForEachChild(visit)
	}
	return visit(node)
}

// pauses reports whether evaluating node, an expression, calls something
// TypeScript sees as an Effect: it runs a call that runs an Effect, looks up
// a service, or calls a .vibe function, including one that compiles to
// plain JavaScript, whose TypeScript type is an Effect too (D10, D67).
func (a *analyzer) pauses(node *ast.Node) bool {
	node = byNameSubject(node)
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if isInvocation(n) && (a.performs(n) || a.callsVibeLangFunction(n)) {
			return true
		}
		return n.ForEachChild(visit)
	}
	return visit(node)
}

// callsVibeLangFunction reports whether call calls a .vibe function other
// than a producer, whose call builds a Stream.
func (a *analyzer) callsVibeLangFunction(call *ast.Node) bool {
	signature := a.checker.GetResolvedSignature(call)
	if signature == nil {
		return false
	}
	fn := implementationOf(signature.Declaration())
	return fn != nil && isLowerable(fn) && !isProducer(fn)
}

// byNameType returns Effect<A, E, R> for node passed by name, given A, the
// type of its value where it runs: E and R are what running node adds, as
// for the body of the lambda () => node.
func (a *analyzer) byNameType(node *ast.Node, success *checker.Type) *checker.Type {
	// The assertion describes the program, not its completed value. Keep its
	// A/E/R while delaying the operand under D147, including a pipe topic.
	if asserted := assertedProgramType(a.checker, node); asserted != nil {
		return asserted
	}
	node = byNameSubject(node)
	info := a.flowOf(node)
	success = a.byNameSuccess(node, success, info)
	effect := info.effect
	if effect == nil {
		effect = a.programEffectInterface()
	}
	if effect == nil {
		effect = a.effectInterface
	}
	if effect == nil {
		return nil
	}
	return a.checker.NewTypeReference(effect, []*checker.Type{success, a.checker.GetUnionType(info.errors), a.checker.GetUnionType(info.requirements)})
}

// byNameResults visits only result positions, leaving conditions, operands,
// and the left side of a comma in their ordinary running form.
func byNameResults(node *ast.Node, visit func(*ast.Node)) {
	node = ast.SkipOuterExpressions(node, ast.OEKParentheses|ast.OEKTypeAssertions|ast.OEKNonNullAssertions|ast.OEKSatisfies)
	switch node.Kind {
	case ast.KindConditionalExpression:
		byNameResults(node.AsConditionalExpression().WhenTrue, visit)
		byNameResults(node.AsConditionalExpression().WhenFalse, visit)
		return
	case ast.KindBinaryExpression:
		binary := node.AsBinaryExpression()
		switch binary.OperatorToken.Kind {
		case ast.KindCommaToken:
			byNameResults(binary.Right, visit)
			return
		case ast.KindBarBarToken, ast.KindQuestionQuestionToken:
			byNameResults(binary.Left, visit)
			byNameResults(binary.Right, visit)
			return
		}
	}
	visit(node)
}

// heldByName reports a program already held as a value, including D24
// subtypes. A running call's value may itself be an Effect: that is A of
// the outer program and must stay intact.
func (a *analyzer) heldByName(node *ast.Node, t *checker.Type) bool {
	node = ast.SkipOuterExpressions(node, ast.OEKParentheses|ast.OEKTypeAssertions|ast.OEKNonNullAssertions|ast.OEKSatisfies)
	if isPipe(node) {
		// A pipe has its body's value. If that body runs a call, a structured
		// success (notably Exit) is data, just as for a direct call (D24).
		return a.heldByName(node.AsBinaryExpression().Right, t)
	}
	return !(isInvocation(node) && (a.runs(node) || a.directCallee(node) != nil)) &&
		effectInterfaceSymbol(a.checker, a.checker.GetNonNullableType(t)) != nil
}

func (a *analyzer) byNameSuccess(node *ast.Node, value *checker.Type, info *effectInfo) *checker.Type {
	// A skipped inference argument must still infer nothing.
	if isPlaceholderNever(value) {
		return value
	}
	var successes []*checker.Type
	hasHeld := false
	byNameResults(node, func(result *ast.Node) {
		t := value
		if result != node {
			t = a.checker.GetTypeAtLocation(result)
		}
		a.heldPrograms[result] = a.heldByName(result, t)
		if a.heldPrograms[result] {
			hasHeld = true
			t = a.checker.GetNonNullableType(t)
			info.addError(programChannelType(a.checker, t, "_E"), result)
			info.addRequirement(programChannelType(a.checker, t, "_R"), result)
			t = programChannelType(a.checker, t, "_A")
		}
		if t != nil {
			successes = append(successes, t)
		}
	})
	if !hasHeld {
		return value // keep TypeScript's narrowing and contextual instantiation
	}
	return a.checker.GetUnionType(successes)
}

// isByName reports whether node is an expression passed by name (D147). It
// resolves the call node is an argument of first, which decides it. The left
// side of a pipe is passed by name when a topic of its body is (D155).
func (a *analyzer) isByName(node *ast.Node) bool {
	if pipe := pipeOfLeft(node); pipe != nil {
		return a.pipeIsByName(pipe)
	}
	if mayBeKeywordOperand(node) && a.keywordOperand(node) {
		return true // a program by syntax (D322)
	}
	if a.conversions[node] == nil {
		if !mayRunByName(node) {
			return false
		}
		call, _ := ownerCall(node)
		if call == nil {
			// A field initializer has no owning call to resolve. Before the
			// checker reaches it, its contextual type decides: a pipe in an
			// Effect-typed field is held, as the check later records (D265).
			return isPipe(ast.SkipParentheses(node)) && holdsProgram(a.checker, node)
		}
		if a.resolving[call] {
			return false
		}
		// The checker may be resolving call already, checking this node as
		// one of its arguments: marked, a check of the argument that this
		// resolution starts again answers false here instead of resolving
		// call once more, which recursed without end.
		a.resolving[call] = true
		a.checker.GetResolvedSignature(call)
		delete(a.resolving, call)
	}
	return a.finalConversion(node) == convertByName
}

// byNameOf returns the expression passed by name that evaluates node, or nil:
// node itself or an ancestor in the same function.
func (a *analyzer) byNameOf(node *ast.Node) *ast.Node {
	for n := node; n != nil && !isFunctionBoundary(n); n = n.Parent {
		if a.conversions[n] != nil && a.finalConversion(n) == convertByName || mayBeKeywordOperand(n) && a.keywordOperand(n) {
			return n
		}
		if pipe := pipeOfLeft(n); pipe != nil && a.pipeIsByName(pipe) {
			return n
		}
	}
	return nil
}

// byNameOwner returns the call that receives byName, an expression passed by
// name, as a program: the call it is an argument of, or, for a pipe's left
// side, the call whose argument is the first topic passed by name.
func (a *analyzer) byNameOwner(byName *ast.Node) *ast.Node {
	if pipe := pipeOfLeft(byName); pipe != nil {
		for _, topic := range topicsOf(pipe) {
			if a.isByName(topic) {
				owner, _ := ownerCall(topic)
				return owner
			}
		}
		return nil
	}
	owner, _ := ownerCall(byName)
	return owner
}

// programOf returns the Effect that t, a function with no required parameters
// that returns an Effect, converts to, or nil.
func (a *analyzer) programOf(t *checker.Type) *checker.Type {
	signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall)
	if len(signatures) != 1 || signatures[0].MinArgumentCount() != 0 || len(signatures[0].TypeParameters()) != 0 {
		return nil
	}
	if returned := a.checker.GetReturnTypeOfSignature(signatures[0]); isEffectType(a.checker, returned) {
		return returned
	}
	return nil
}

// programsOf returns the array or record of Effects that t, an iterable or a
// record of programs, converts to, or nil. An iterable, such as an array, a
// Set, or a Map's values, converts to an array, as $programs makes it one.
// Like Effect.all, it treats an iterable as an iterable, never as a record.
func (a *analyzer) programsOf(t *checker.Type) *checker.Type {
	if a.checker.GetSignaturesOfType(t, checker.SignatureKindCall) != nil {
		return nil
	}
	if elements, iterable := a.iteratedTypes(t); iterable {
		if len(elements) == 0 {
			return nil
		}
		var effects []*checker.Type
		for _, element := range elements {
			effect := a.programOf(element)
			if effect == nil {
				return nil
			}
			effects = append(effects, effect)
		}
		return a.checker.CreateArrayType(a.checker.GetUnionType(effects), false)
	}
	ok := true
	converted := a.checker.MapObjectType(t, func(value *checker.Type) *checker.Type {
		if effect := a.programOf(value); effect != nil {
			return effect
		}
		ok = false
		return value
	})
	if !ok || len(a.checker.GetPropertiesOfType(t)) == 0 && len(a.checker.GetIndexInfosOfType(t)) == 0 {
		return nil
	}
	return converted
}

// iteratedTypes returns the element types of t and true when t is iterable:
// an array, a tuple, or an object with a [Symbol.iterator] method.
func (a *analyzer) iteratedTypes(t *checker.Type) ([]*checker.Type, bool) {
	if a.checker.IsArrayLikeType(t) {
		return a.elementTypes(t, 0), true
	}
	if element := a.checker.IteratedType(t); element != nil {
		return []*checker.Type{element}, true
	}
	return nil, false
}

// finalConversion is what node compiles to: the conversion the candidate its
// call selected asked for, or, when no candidate accepted the call, the one
// the first candidate asked for.
func (a *analyzer) finalConversion(node *ast.Node) conversion {
	s := a.conversions[node]
	if s == nil {
		return convertNone
	}
	call, _ := ownerCall(node)
	if call == nil {
		return s.first
	}
	if signature := a.candidateOf(call); signature != nil {
		if conv, ok := s.byCandidate[keyOf(signature)]; ok {
			return conv
		}
	}
	return s.first
}

// esFunctionOf returns the .vibe function that node, an identifier or a
// namespace member such as M.double, names: a function declaration, or a
// variable initialized with a lambda.
func esFunctionOf(c *checker.Checker, node *ast.Node) *ast.Node {
	if !ast.IsIdentifier(node) && !(ast.IsPropertyAccessExpression(node) && ast.IsIdentifier(node.Name())) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return nil
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil {
		return nil
	}
	if ast.IsVariableDeclaration(declaration) && declaration.Initializer() != nil {
		declaration = ast.SkipParentheses(declaration.Initializer())
	}
	if isLowerable(declaration) {
		return implementationOf(declaration)
	}
	return nil
}

// assertedProgramType returns an explicit Effect assertion on a by-name
// expression. An assertion does not turn a running operand into a cold value.
func assertedProgramType(c *checker.Checker, node *ast.Node) *checker.Type {
	node = ast.SkipParentheses(byNameSubject(node))
	if ast.IsAsExpression(node) || ast.IsTypeAssertion(node) {
		t := c.GetTypeFromTypeNode(node.Type())
		if isEffectType(c, t) {
			return t
		}
	}
	return nil
}

// assertionOperandType checks a program assertion against its delayed operand,
// once the surrounding call has chosen its by-name conversion.
// Pipes check their left side before their stages, so doing this in the call
// type hook would ask for a program position before that position is known.
func assertionOperandType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if !isVibeLangFile(ast.GetSourceFileOfNode(node)) || inHatch(node) || assertedProgramType(c, node) == nil {
		return t
	}
	a := analyzerFor(c)
	outer := node
	for outer.Parent != nil && ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if !a.isByName(node) && !a.isByName(outer) {
		return t
	}
	if program := a.byNameType(node.Expression(), t); program != nil {
		return program
	}
	return t
}
