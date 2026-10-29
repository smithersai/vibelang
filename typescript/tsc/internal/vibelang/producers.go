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
// body can fail with and needs. Generator methods stay JavaScript's.
//
// for...of over a value whose type is a Stream, a producer or any other, is
// a loop over its elements (D26). The loop body is a region (regions.go)
// whose closure takes the element, and the runtime's $forOf runs the closure
// once per element, pulling the Stream. $forOf handles the body's break and continue of its
// own loop, and the enclosing generator dispatches every other jump:
//
//	for (const line of lines(path)) {      const completion = yield* runtime.$forOf(lines(path),
//	  if (line.startsWith("ERROR")) break      Effect.fnUntraced(function* firstErrors$for(line) {
//	  count++                                    if (line.startsWith("ERROR")) return { kind: "break", label: "" };
//	}                                            count++;
//	                                             return runtime.$normal;
//	                                           }));
//
// Over any other iterable, for...of is JavaScript's loop.

// isProducer reports whether fn is a producer: a function* declaration or
// function expression, not async, with a body, in a .vibe file, without
// a JavaScript iterator return annotation (D271, amending D26).
func isProducer(fn *ast.Node) bool {
	if fn.Kind != ast.KindFunctionDeclaration && fn.Kind != ast.KindFunctionExpression || fn.Body() == nil {
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
	loops          map[*ast.Node]bool // for...of statements, by whether they iterate a Stream
	pausing        map[*ast.Node]bool // functions, by whether their body loops over a Stream
}

type producerStateKey struct{}

func producersOf(c *checker.Checker) *producerState {
	return c.ExtensionState(producerStateKey{}, func() any {
		return &producerState{loops: map[*ast.Node]bool{}, pausing: map[*ast.Node]bool{}}
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
	return c.NewTypeReference(stream, []*checker.Type{element, c.GetUnionType(errors), c.GetUnionType(requirements)})
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
// body of a .vibe function, a for...of statement over a Stream iterates the
// Stream's elements, and so does a yield* of a Stream in a producer.
func iteratedElementType(c *checker.Checker, node *ast.Node, iterated *checker.Type) *checker.Type {
	switch node.Kind {
	case ast.KindForOfStatement:
		if node.AsForInOrOfStatement().AwaitModifier != nil || !inLowerableBody(node) {
			return nil
		}
	case ast.KindYieldExpression:
		if fn := ast.GetContainingFunction(node); fn == nil || !isProducer(fn) {
			return nil
		}
	default:
		return nil
	}
	return streamChannel(c, iterated, "_A")
}

// isStreamLoop reports whether statement is a for...of over a Stream in the
// body of a .vibe function.
func isStreamLoop(c *checker.Checker, statement *ast.Node) bool {
	if statement.Kind != ast.KindForOfStatement || statement.AsForInOrOfStatement().AwaitModifier != nil || !inLowerableBody(statement) {
		return false
	}
	s := producersOf(c)
	if loop, ok := s.loops[statement]; ok {
		return loop
	}
	s.loops[statement] = false // a loop whose iterated type depends on itself is JavaScript's
	loop := streamChannel(c, c.GetTypeAtLocation(statement.Expression()), "_A") != nil
	s.loops[statement] = loop
	return loop
}

// forEachStreamLoop calls cb for each for...of over a Stream in fn's own
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
	iterated := a.checker.GetTypeAtLocation(statement.Expression())
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
	if loop.AwaitModifier != nil || !inLowerableBody(statement) || isStreamLoop(c, statement) {
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
	block.Loc = node.Body().Loc
	var lowered *ast.Node
	if node.Kind == ast.KindFunctionDeclaration {
		lowered = f.UpdateFunctionDeclaration(node.AsFunctionDeclaration(), node.Modifiers(), nil /*asteriskToken*/, node.Name(), nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, block)
	} else {
		lowered = f.UpdateFunctionExpression(node.AsFunctionExpression(), node.Modifiers(), nil /*asteriskToken*/, node.Name(), nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, block)
	}
	ec.SetOriginal(lowered, node)
	return lowered
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

// visitStreamLoop lowers a for...of over a Stream to a region whose closure
// takes each element, run by runtime.$forOf.
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

	r := &region{}
	var binding *ast.Node  // the declaration the closure takes the element as
	var prologue *ast.Node // the assignment of the element to an existing target
	if isUsingForOf(node) {
		// for (using x of s): each element's iteration is a Scope region
		// (scopes_lower.go), and the closure returns its completion record.
		value := f.NewUniqueName("value")
		binding = f.NewVariableDeclaration(value, nil /*exclamationToken*/, nil /*typeNode*/, nil /*initializer*/)
		iteration := &region{}
		run := f.NewYieldExpression(f.NewToken(ast.KindAsteriskToken), tx.usingIteration(iteration, node, value))
		body := tx.regionFunction(r, "for", binding, loop.Statement, []*ast.Node{f.NewReturnStatement(run)})
		r.jumps = iteration.jumps
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
	return tx.runForOf(node, iterable, body, label, r)
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
	arguments := []*ast.Node{iterable, body}
	if label != "" {
		arguments = append(arguments, f.NewStringLiteral(label, ast.TokenFlagsNone))
	}
	// $forOf handles break and continue of this loop itself.
	r.jumps = slices.DeleteFunc(r.jumps, func(j jump) bool {
		return j.kind != ast.KindReturnStatement && (j.label == "" || j.label == label)
	})
	return tx.runRegion(node, tx.runtimeCall("$forOf", arguments...), r)
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
