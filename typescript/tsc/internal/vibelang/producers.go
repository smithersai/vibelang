package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// Producers and loops over streams (design D26, chapters 8 and 26).
//
//	function* lines(path: string) {        function lines(path) {
//	  const file = Files.open(path)            return runtime.$produce(Effect.fnUntraced(function* lines() {
//	  while (true) {                               const file = yield* (yield* Files).open(path);
//	    const line = file.readLine()               while (true) {
//	    if (line === undefined) return                 const line = yield* file.readLine();
//	    yield line                                     if (line === undefined) return;
//	  }                                                yield* runtime.$yield(line);
//	}                                              }
//	                                           }));
//	                                         }
//
// A function* declaration or function expression in a .vibe file is a
// producer unless it has a JavaScript iterator return annotation (D271).
// Its body is an Effect body, as any .vibe function's is, so its calls
// run; `yield v` offers v to the producer's queue, and `yield* p` yields
// every element of p. Calling a producer runs none of its body: it returns a
// Stream, the runtime's $produce, which is Effect's Stream.callback with one
// element of buffer, so the body runs on a fiber of its own and may run up to
// two elements ahead of its consumer (VIP-21). To TypeScript, and to
// every caller, a producer is therefore a function that returns
// Stream<T, E, R>: T joins the types of its yields, and E and R are what its
// body can fail with and needs. A method marked effect is a producer too;
// unmarked generator methods stay JavaScript's (VIP-21).
//
// VIP-20: for try consumes a Stream with Stream.runForEachWhile.
// Ordinary for...of always retains its JavaScript iterator meaning.

// isProducer reports whether fn is a producer: a function* declaration or
// function expression, not async, with a body, in a .vibe file, without
// a JavaScript iterator return annotation (D271, amending D26). VIP-21
// also admits an explicitly marked generator method.
func isProducer(fn *ast.Node) bool {
	if fn.Kind != ast.KindFunctionDeclaration && fn.Kind != ast.KindFunctionExpression && !(fn.Kind == ast.KindMethodDeclaration && isMarkedEffect(fn)) || fn.Body() == nil {
		return false
	}
	flags := ast.GetFunctionFlags(fn)
	return flags&ast.FunctionFlagsGenerator != 0 && flags&ast.FunctionFlagsAsync == 0 && isVibeLangFile(ast.GetSourceFileOfNode(fn)) && !vibelangmapper.HasJavaScriptIteratorReturn(fn)
}

// streamTypeID names the variance property that every Effect 4 Stream has:
// `readonly [TypeId]: VarianceStruct<A, E, R>` with `TypeId = "~effect/Stream"`.
const streamTypeID = "~effect/Stream"

// producerState is what one checker remembers about producers and loops.
type producerState struct {
	stream         *checker.Type // effect's generic Stream interface, found in the program's files
	streamSearched bool
	pausing        map[*ast.Node]bool // functions, by whether their body loops over a Stream
}

type producerStateKey struct{}

func producersOf(c *checker.Checker) *producerState {
	return c.ExtensionState(producerStateKey{}, func() any {
		return &producerState{pausing: map[*ast.Node]bool{}}
	}).(*producerState)
}

// streamInterface returns the generic Stream interface that effect's Stream
// module declares, or nil when the program does not include it.
func streamInterface(c *checker.Checker) *checker.Type {
	s := producersOf(c)
	if s.streamSearched {
		return s.stream
	}
	s.streamSearched = true
	for _, file := range c.Program().SourceFiles() {
		if !isEffectModuleFile(file, "Stream") || file.Symbol == nil {
			continue
		}
		for _, export := range c.GetExportsOfModule(file.Symbol) {
			if export.Name() == "Stream" && export.Flags()&ast.SymbolFlagsInterface != 0 {
				s.stream = c.GetDeclaredTypeOfSymbol(export)
				return s.stream
			}
		}
	}
	return nil
}

// producerType gives a producer the type of the Stream it returns,
// Stream<T, E, R>, given t, the generator type TypeScript inferred for it,
// Generator<T, TReturn, TNext>. Without effect's Stream module in the
// program, the producer keeps t.
func producerType(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	stream := streamInterface(c)
	if stream == nil {
		return t
	}
	element := c.GetNeverType()
	if t != nil && t.Flags()&checker.TypeFlagsObject != 0 && t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		if arguments := c.GetTypeArguments(t); len(arguments) > 0 {
			// Widened as a return type is: `yield 1` yields number.
			element = c.GetWidenedType(c.GetWidenedLiteralType(arguments[0]))
		}
	}
	var errors, requirements []*checker.Type
	if info := analyzerFor(c).effectOf(fn); info != nil {
		errors, requirements = info.errors, info.requirements
	}
	// The Stream's callback supplies the Scope the body's scoped forks and
	// resources need, as Stream.callback's does, so the Stream's requirements
	// are the body's without Scope (decided detail 225).
	required := c.GetUnionType(requirements)
	if scope := analyzerFor(c).programScope(); scope != nil {
		required = c.ExcludeType(required, scope)
	}
	return c.NewTypeReference(stream, []*checker.Type{element, c.GetUnionType(errors), required})
}

// streamChannel returns one channel of t, a Stream or a union of Streams:
// "_A" for its elements, "_E" for its failures, "_R" for its requirements. It
// returns nil when t is not a Stream.
func streamChannel(c *checker.Checker, t *checker.Type, name string) *checker.Type {
	if t == nil {
		return nil
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		var channels []*checker.Type
		for _, member := range t.Types() {
			channel := streamChannel(c, member, name)
			if channel == nil {
				return nil
			}
			channels = append(channels, channel)
		}
		return c.GetUnionType(channels)
	}
	if t.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 {
		return nil
	}
	variance := c.GetTypeOfPropertyOfType(t, streamTypeID) // VarianceStruct<A, E, R>
	if variance == nil {
		return nil
	}
	covariant := c.GetTypeOfPropertyOfType(variance, name) // (_: never) => Channel
	if covariant == nil {
		return nil
	}
	signatures := c.GetSignaturesOfType(covariant, checker.SignatureKindCall)
	if len(signatures) != 1 {
		return nil
	}
	return c.GetReturnTypeOfSignature(signatures[0])
}

// iteratedElementType is the checker's iterated element type hook. In the
// body of a .vibe function, a for try statement over a Stream iterates the
// Stream's elements, and so does a yield* of a Stream in a producer.
func iteratedElementType(c *checker.Checker, node *ast.Node, iterated *checker.Type) *checker.Type {
	switch node.Kind {
	case ast.KindForOfStatement:
		if !isForTry(node) || !inLowerableBody(node) {
			return nil
		}
	case ast.KindYieldExpression:
		if fn := ast.GetContainingFunction(node); fn == nil || !isProducer(fn) {
			return nil
		}
	default:
		return nil
	}
	// Only explicit for try uses the operand-domain rule. Native loops must
	// not acquire Stream semantics merely because their operand is any.
	if isForTry(node) && iterated != nil && iterated.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 {
		return iterated
	}
	return streamChannel(c, c.GetApparentType(iterated), "_A")
}

// isStreamLoop recognizes explicit for try syntax in an Effect body.
// The operand type determines its channels, never the loop semantics.
func isStreamLoop(c *checker.Checker, statement *ast.Node) bool {
	return isForTry(statement) && inLowerableBody(statement)
}

// forEachStreamLoop calls cb for each for try in fn's own
// body, skipping nested functions and classes, until cb returns true. It
// reports whether cb returned true.
func forEachStreamLoop(c *checker.Checker, fn *ast.Node, cb func(loop *ast.Node) bool) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if node.Kind == ast.KindForOfStatement && isStreamLoop(c, node) && cb(node) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return fn.Body() != nil && visit(fn.Body())
}

// hasStreamLoop reports whether fn's own body loops over a Stream, which can
// pause, so fn must compile to an Effect.
func (a *analyzer) hasStreamLoop(fn *ast.Node) bool {
	s := producersOf(a.checker)
	if pausing, ok := s.pausing[fn]; ok {
		return pausing
	}
	s.pausing[fn] = false
	pausing := forEachStreamLoop(a.checker, fn, func(*ast.Node) bool { return true })
	s.pausing[fn] = pausing
	return pausing
}

// addStreamLoop adds what statement, a for...of over a Stream, adds to E and
// R: the Stream's failures and requirements. Its body's own calls are part of
// the enclosing flow.
func (a *analyzer) addStreamLoop(info *effectInfo, statement *ast.Node) {
	if !isStreamLoop(a.checker, statement) {
		return
	}
	iterated := a.checker.GetApparentType(a.checker.GetTypeAtLocation(statement.Expression()))
	if e := streamChannel(a.checker, iterated, "_E"); e != nil {
		info.addError(e, statement)
	}
	if r := streamChannel(a.checker, iterated, "_R"); r != nil {
		info.addRequirement(r, statement)
	}
}

// producerPlan records what the lowering does with producers in one file.
type producerPlan struct {
	producers   map[*ast.Node]bool // producer functions
	streamLoops map[*ast.Node]bool // for...of statements over a Stream, or that must close their iterator (isClosingLoop), in Effect bodies
}

func newProducerPlan() producerPlan {
	return producerPlan{producers: map[*ast.Node]bool{}, streamLoops: map[*ast.Node]bool{}}
}

// planProducer records fn, a function the lowering turns into an Effect,
// when it is a producer, and the loops over Streams in its body.
func (p *producerPlan) planProducer(c *checker.Checker, fn *ast.Node) {
	if isProducer(fn) {
		p.producers[fn] = true
	}
	forEachStreamLoop(c, fn, func(loop *ast.Node) bool {
		p.streamLoops[loop] = true
		return false
	})
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if node.Kind == ast.KindForOfStatement && isClosingLoop(c, node) {
			p.streamLoops[node] = true
		}
		return node.ForEachChild(visit)
	}
	if fn.Body() != nil {
		visit(fn.Body())
	}
}

// isClosingLoop reports whether statement, a for...of over an iterable that is
// not a Stream in an Effect body, must close its iterator itself. JavaScript's
// for...of calls the iterator's return() on every abrupt exit, but Effect
// abandons a generator at a failed or interrupted yield* without calling its
// return(), so the loop's own iterator needs Effect ownership. A loop whose body can
// pause or fail runs through $forOf instead, which closes the iterator on
// every exit that does not finish it, as JavaScript does. A loop this leaves
// native is protected by protectIteratorFrames (iterators_lower.go), which
// covers an array with its own iterator and a binding that pauses.
func isClosingLoop(c *checker.Checker, statement *ast.Node) bool {
	loop := statement.AsForInOrOfStatement()
	if loop.AwaitModifier != nil || !inLowerableBody(statement) || isForTry(statement) {
		return false
	}
	if initializer := loop.Initializer; ast.IsVariableDeclarationList(initializer) && len(initializer.AsVariableDeclarationList().Declarations.Nodes) == 0 {
		return false // for (using of rs): a syntax error the parser reported
	}
	t := c.GetTypeAtLocation(loop.Expression)
	if t == nil || t.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsStringLike) != 0 || c.IsArrayLikeType(t) {
		return false
	}
	return bodyPauses(c, loop.Statement)
}

// bodyPauses reports whether statement, in an Effect body, can stop at a yield*
// where its fiber may fail or be interrupted: it runs a call, throws, yields,
// loops over a Stream, or has a try statement, which runs as regions.
func bodyPauses(c *checker.Checker, statement *ast.Node) bool {
	a := analyzerFor(c)
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case isFunctionBoundary(node):
			return false
		case node.Kind == ast.KindThrowStatement || node.Kind == ast.KindYieldExpression || node.Kind == ast.KindTryStatement:
			return true
		case node.Kind == ast.KindForOfStatement && isStreamLoop(c, node):
			return true
		case isInvocation(node) && a.runs(node):
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(statement)
}

// visitProducer turns a producer into a plain function that returns
// runtime.$produce(Effect.fnUntraced(function* name() { body })): its
// parameters stay on the plain function, and its body, an Effect body, runs
// each time the Stream it returns runs.
//
// Parameters are bound at the call, but the call never throws: when binding
// can throw, as destructuring undefined does, the call returns a Stream that
// dies with the thrown value (003-failures.md, Code outside the generator).
// Such parameters move to an arrow the plain function calls in a try:
//
//	function s(arg_1) {
//	  try { return (({ id }) => runtime.$produce(…))(...arguments) }
//	  catch (e) { return runtime.$produce(() => Effect.die(e)) }
//	}
//
// The placeholders keep the function's length, and the arrow keeps this.
func (tx *lowering) visitProducer(node *ast.Node) *ast.Node {
	f := tx.Factory()
	ec := tx.EmitContext()

	saved, savedFrame, savedPlain := tx.inEffect, tx.frame, tx.plain
	tx.inEffect, tx.plain = false, false // parameter initializers stay plain
	parameters := ec.VisitParameters(node.ParameterList(), tx.Visitor())
	tx.inEffect = true
	tx.frame = &frame{name: sourceName(node)}
	body := ec.VisitFunctionBody(node.Body(), tx.Visitor())
	tx.inEffect, tx.frame, tx.plain = saved, savedFrame, savedPlain

	generator := tx.generatorExpression(node, sourceName(node), f.NewNodeList(nil), body)
	if refersToOwnName(node) {
		// The plain function keeps the name (frames_lower.go).
		generator = tx.nameFreeGenerator(node, node.Name().Text(), f.NewNodeList(nil), body)
	}
	tx.EmitContext().SetOriginal(generator, node)
	run := tx.wrapGenerator("fnUntraced", node, generator)
	run.Loc = core.UndefinedTextRange() // the function keeps the source's comments
	if usesThis(node.Body()) {
		run = f.NewFunctionBindCall(run, f.NewThisExpression(), nil /*argumentsList*/)
	}
	produce := tx.runtimeCall("$produce", run)
	block := f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(produce)}), true /*multiLine*/)
	if bindingMayThrow(node) {
		parameters, block = tx.producerBindingBoundary(node, parameters, produce)
	}
	block.Loc = node.Body().Loc
	var lowered *ast.Node
	if node.Kind == ast.KindFunctionDeclaration {
		lowered = f.UpdateFunctionDeclaration(node.AsFunctionDeclaration(), node.Modifiers(), nil /*asteriskToken*/, node.Name(), nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, block)
	} else if node.Kind == ast.KindMethodDeclaration {
		method := node.AsMethodDeclaration()
		lowered = f.UpdateMethodDeclaration(method, node.Modifiers(), nil /*asteriskToken*/, node.Name(), method.PostfixToken, method.TypeParameters, parameters, method.Type, method.FullSignature, block)
	} else {
		lowered = f.UpdateFunctionExpression(node.AsFunctionExpression(), node.Modifiers(), nil /*asteriskToken*/, node.Name(), nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, block)
	}
	ec.SetOriginal(lowered, node)
	return lowered
}

// bindingMayThrow reports whether binding fn's parameters can throw: a
// parameter is a binding pattern or has a default.
func bindingMayThrow(fn *ast.Node) bool {
	for _, parameter := range fn.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		if !ast.IsIdentifier(parameter.Name()) || parameter.Initializer() != nil {
			return true
		}
	}
	return false
}

// producerBindingBoundary returns the placeholder parameters and the body
// that bind parameters, the producer's lowered parameters, in a try whose
// catch returns a Stream that dies with the thrown value (visitProducer).
func (tx *lowering) producerBindingBoundary(node *ast.Node, parameters *ast.NodeList, produce *ast.Node) (*ast.NodeList, *ast.Node) {
	f := tx.Factory()
	var bound, placeholders []*ast.Node
	for _, parameter := range parameters.Nodes {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue // TypeScript's this parameter types the plain function only
		}
		bound = append(bound, parameter)
	}
	for _, parameter := range node.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		p := parameter.AsParameterDeclaration()
		if p.Initializer != nil || p.DotDotDotToken != nil {
			break
		}
		placeholders = append(placeholders, f.NewParameterDeclaration(nil, nil, f.NewUniqueName("arg"), nil, nil, nil))
	}
	bind := f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList(bound), nil /*returnType*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), produce)
	call := f.NewCallExpression(f.NewParenthesizedExpression(bind), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{f.NewSpreadElement(f.NewIdentifier("arguments"))}), ast.NodeFlagsNone)
	thrown := f.NewUniqueName("e")
	die := f.NewCallExpression(f.NewPropertyAccessExpression(tx.effectName(), nil /*questionDotToken*/, f.NewIdentifier("die"), ast.NodeFlagsNone), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{thrown}), ast.NodeFlagsNone)
	dies := tx.runtimeCall("$produce", f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList(nil), nil /*returnType*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), die))
	catch := f.NewCatchClause(f.NewVariableDeclaration(thrown, nil, nil, nil), f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(f.NewReturnStatement(dies))}), true /*multiLine*/))
	try := f.NewTryStatement(f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(call)}), true /*multiLine*/), catch, nil /*finallyBlock*/)
	return f.NewNodeList(placeholders), f.NewBlock(f.NewNodeList([]*ast.Node{tx.generated(try)}), true /*multiLine*/)
}

// visitYield turns `yield v` in a producer into `yield* runtime.$yield(v)`,
// which performs Yield, and `yield* p` into `yield* runtime.$yieldAll(p)`.
func (tx *lowering) visitYield(node *ast.Node) *ast.Node {
	f := tx.Factory()
	y := node.AsYieldExpression()
	helper := "$yield"
	if y.AsteriskToken != nil {
		helper = "$yieldAll"
	}
	var arguments []*ast.Node
	if y.Expression != nil {
		arguments = append(arguments, tx.Visitor().VisitNode(y.Expression))
	}
	run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.runtimeCall(helper, arguments...))
	tx.EmitContext().SetOriginal(run, node)
	run.Loc = node.Loc
	return run
}

// visitStreamLoop builds the per-element callback. Explicit for try uses
// Stream.runForEachWhile; owned JavaScript iterators retain their protocol.
func (tx *lowering) visitStreamLoop(node *ast.Node) *ast.Node {
	f := tx.Factory()
	loop := node.AsForInOrOfStatement()
	label := ""
	if parent := node.Parent; parent != nil && parent.Kind == ast.KindLabeledStatement {
		label = parent.AsLabeledStatement().Label.Text()
	}
	initializer := loop.Initializer
	if ast.IsVariableDeclarationList(initializer) && len(initializer.AsVariableDeclarationList().Declarations.Nodes) == 0 {
		// for (const of s): a syntax error the parser reported, emitted as written.
		return tx.Visitor().VisitEachChild(node)
	}
	iterable := tx.Visitor().VisitNode(loop.Expression)

	r := &region{forTry: isForTry(node)}
	var binding *ast.Node  // the declaration the closure takes the element as
	var prologue *ast.Node // the assignment of the element to an existing target
	if isUsingForOf(node) {
		// for (using x of s): each element's iteration is a Scope region
		// (scopes_lower.go), and the closure returns its completion record.
		value := f.NewUniqueName("value")
		binding = f.NewVariableDeclaration(value, nil /*exclamationToken*/, nil /*typeNode*/, nil /*initializer*/)
		iteration := &region{forTry: isForTry(node)}
		run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.usingIteration(iteration, node, value))
		body := tx.regionFunction(r, "for", binding, loop.Statement, []*ast.Node{f.NewReturnStatement(run)})
		r.jumps = iteration.jumps
		if isForTry(node) {
			return tx.runForTry(node, iterable, body)
		}
		return tx.runForOf(node, iterable, body, label, r)
	}
	if ast.IsVariableDeclarationList(initializer) && initializer.Flags&ast.NodeFlagsBlockScoped != 0 {
		binding = initializer.AsVariableDeclarationList().Declarations.Nodes[0]
	} else {
		// for (x of s), for (o.p of s), and for (var x of s): the closure
		// takes the element and assigns it, as the loop would.
		element := f.NewUniqueName("element")
		binding = f.NewVariableDeclaration(element, nil /*exclamationToken*/, nil /*typeNode*/, nil /*initializer*/)
		var target *ast.Node
		if ast.IsVariableDeclarationList(initializer) {
			name := initializer.AsVariableDeclarationList().Declarations.Nodes[0].Name()
			tx.hoist(name)
			target = tx.visitInFrame(r, name)
			if ast.IsBindingPattern(target) {
				target = transformers.ConvertBindingPatternToAssignmentPattern(tx.EmitContext(), target.AsBindingPattern())
			}
		} else {
			target = tx.visitInFrame(r, initializer)
		}
		prologue = f.NewExpressionStatement(f.NewAssignmentExpression(target, element))
	}
	statements := tx.loopBodyStatements(r, loop.Statement)
	if prologue != nil {
		statements = append([]*ast.Node{prologue}, statements...)
	}
	body := tx.regionFunction(r, "for", binding, loop.Statement, statements)
	if isForTry(node) {
		return tx.runForTry(node, iterable, body)
	}
	return tx.runForOf(node, iterable, body, label, r)
}

// runForTry consumes the Stream with the callback specified by VIP-20.
func (tx *lowering) runForTry(node, iterable, body *ast.Node) *ast.Node {
	f := tx.Factory()
	callee := f.NewPropertyAccessExpression(tx.moduleNamespace("effect/Stream"), nil, f.NewIdentifier("runForEachWhile"), ast.NodeFlagsNone)
	run := f.NewCallExpression(callee, nil, nil, f.NewNodeList([]*ast.Node{iterable, body}), ast.NodeFlagsNone)
	statement := f.NewExpressionStatement(f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), run))
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// closingLoopLabel maps labels on the same closing loop to the one $forOf
// receives. All those labels name the same iteration target in JavaScript.
// Only the innermost label is passed to $forOf; an outer alias must not escape
// as a continue to the block the lowering puts in place of that loop.
func (tx *lowering) closingLoopLabel(node *ast.Node, label string) string {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if ast.IsFunctionLike(parent) {
			break
		}
		if parent.Kind != ast.KindLabeledStatement || parent.AsLabeledStatement().Label.Text() != label {
			continue
		}
		loop := labeledLoop(parent)
		if tx.plan.streamLoops[loop] {
			return loop.Parent.AsLabeledStatement().Label.Text()
		}
		break
	}
	return label
}

// runForOf makes the statements that run `runtime.$forOf(iterable, body,
// label)` for node, a loop whose body closure belongs to region r, and
// dispatch the jumps that leave the loop.
func (tx *lowering) runForOf(node *ast.Node, iterable *ast.Node, body *ast.Node, label string, r *region) *ast.Node {
	f := tx.Factory()
	arguments := []*ast.Node{tx.javaScriptIterable(iterable), body}
	if label != "" {
		arguments = append(arguments, f.NewStringLiteral(label, ast.TokenFlagsNone))
	}
	// $forOf handles break and continue of this loop itself.
	r.jumps = slices.DeleteFunc(r.jumps, func(j jump) bool {
		return j.kind != ast.KindReturnStatement && (j.label == "" || j.label == label)
	})
	return tx.runRegion(node, tx.runtimeCall("$forOf", arguments...), r)
}

// javaScriptIterable prevents the legacy runtime adapter from treating a
// value branded as a Stream as anything but a JavaScript Iterable. The native
// for...of keeps next() argument counts and IteratorClose behavior intact.
func (tx *lowering) javaScriptIterable(iterable *ast.Node) *ast.Node {
	f := tx.Factory()
	source, element := f.NewUniqueName("iterable"), f.NewUniqueName("value")
	parameter := f.NewParameterDeclaration(nil, nil, source, nil, nil, nil)
	declaration := f.NewVariableDeclaration(element, nil, nil, nil)
	initializer := f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{declaration}), ast.NodeFlagsConst)
	loop := f.NewForInOrOfStatement(ast.KindForOfStatement, nil, initializer, source, f.NewExpressionStatement(f.NewYieldExpression(nil, element)))
	generator := f.NewFunctionExpression(nil, f.NewToken(ast.KindAsteriskToken), nil, nil, f.NewNodeList([]*ast.Node{parameter}), nil, nil, f.NewBlock(f.NewNodeList([]*ast.Node{loop}), true))
	return f.NewCallExpression(f.NewParenthesizedExpression(generator), nil, nil, f.NewNodeList([]*ast.Node{iterable}), ast.NodeFlagsNone)
}

// loopBodyStatements visits statement, a loop body, as the statements of a
// closure of region r.
func (tx *lowering) loopBodyStatements(r *region, statement *ast.Node) []*ast.Node {
	if ast.IsBlock(statement) {
		return tx.regionStatements(r, statement)
	}
	visited := tx.visitInFrame(r, statement)
	switch {
	case visited == nil:
		return nil
	case visited.Kind == ast.KindSyntaxList:
		return visited.AsSyntaxList().Children
	}
	return []*ast.Node{visited}
}

// producerAnnotation gives the generator checks of a producer with a written
// Stream.Stream<A, E, R> return type the generator its body is: yields of A,
// a bare return, and unknown sent in. The signature keeps the written Stream
// (chapter 2: a written return type that is not a Stream is EK2102).
func producerAnnotation(c *checker.Checker, fn *ast.Node, t *checker.Type) *checker.Type {
	if !isProducer(fn) {
		return t
	}
	element := streamChannel(c, t, "_A")
	if element == nil {
		return t
	}
	return c.CreateGeneratorType(element, c.GetUndefinedType(), c.GetUnknownType(), false /*isAsyncGenerator*/)
}
