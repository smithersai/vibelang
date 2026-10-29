package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

// effectTypeID names the variance property that every Effect 4 Effect has:
// `readonly [TypeId]: Variance<A, E, R>` with `TypeId = "~effect/Effect"`.
const effectTypeID = "~effect/Effect"

// plan records what the lowering does to one .vibe file.
type plan struct {
	parameterWrites map[*ast.Node]bool // Effect functions whose body writes a parameter binding

	fieldlessErrorConstructors map[*ast.Node]bool
	effects                    map[*ast.Node]bool       // functions lowered to Effect.fnUntraced generators
	programs                   map[*ast.Node]bool       // lambdas lowered to Effect.gen programs (design D7)
	runs                       map[*ast.Node]bool       // calls in those functions emitted as yield*
	heldPrograms               map[*ast.Node]bool       // held values in by-name result positions
	returns                    map[*ast.Node]bool       // returned Effect subtypes executed at an Effect return boundary
	converts                   map[*ast.Node]conversion // function values converted where they are passed
	prelude                    []string                 // prelude names the file uses as values (prelude.go)
	intrinsics                 map[*ast.Node]bool       // intrinsics a source binding would capture, reached through the lowering's own import (prelude.go)
	servicePlan
	plainPlan
	joinPlan
	trustedPlan
	tracingPlan
	scopePlan
	handlerPlan
	producerPlan
	exhaustivePlan
	dataPlan
	hatches     map[*ast.Node]hatchForm  // sync and try hatches, lowered to Effect's functions (hatches.go)
	failureTags map[*ast.Node][]string   // the tags of each typed catch clause's test (catches.go)
	methods     map[*ast.Node]methodCall // method calls on Effect data types (datamethods.go)

	pipes         map[*ast.Node]pipeMode    // how each pipe compiles (pipes_lower.go)
	topicClosures map[*ast.Node][]*ast.Node // functions that read the topic of these pipes

	stable map[*ast.Node]bool // operands a lowering moves that may run anywhere (order.go)

	entry *entryPlan // how an entry module runs its main (entry.go), or nil
}

func (p *plan) isEffect(fn *ast.Node) bool             { return p.effects[fn] }
func (p *plan) isProgram(fn *ast.Node) bool            { return p.programs[fn] }
func (p *plan) runsCall(call *ast.Node) bool           { return p.runs[call] }
func (p *plan) conversionOf(node *ast.Node) conversion { return p.converts[node] }

// planFile asks the checker which functions in file are Effects and which of
// their calls run.
func planFile(resolver printer.EmitResolver, file *ast.SourceFile) *plan {
	p := &plan{effects: map[*ast.Node]bool{}, programs: map[*ast.Node]bool{}, runs: map[*ast.Node]bool{}, heldPrograms: map[*ast.Node]bool{}, converts: map[*ast.Node]conversion{}, servicePlan: newServicePlan(), plainPlan: newPlainPlan(), trustedPlan: newTrustedPlan(), tracingPlan: newTracingPlan(), scopePlan: newScopePlan()}
	p.parameterWrites = map[*ast.Node]bool{}
	p.returns = map[*ast.Node]bool{}
	p.fieldlessErrorConstructors = map[*ast.Node]bool{}
	p.handlerPlan = newHandlerPlan()
	p.hatches = map[*ast.Node]hatchForm{}
	p.failureTags = map[*ast.Node][]string{}
	p.methods = map[*ast.Node]methodCall{}
	p.pipes = map[*ast.Node]pipeMode{}
	p.topicClosures = map[*ast.Node][]*ast.Node{}
	p.producerPlan = newProducerPlan()
	p.exhaustivePlan = newExhaustivePlan()
	p.dataPlan = newDataPlan()
	r, ok := resolver.(*checker.EmitResolver)
	if !ok {
		return p
	}
	r.WithChecker(func(c *checker.Checker) {
		p.prelude = preludeUses(c, file)
		p.intrinsics = preludeStateOf(c).intrinsics
		p.ownExports = moduleExportNames(c, file.Symbol)
		a := analyzerFor(c)
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if form, base := errorFormOf(node); form == errorFormSubclass && fieldlessGeneratedErrorBase(c, base) {
				for _, member := range node.Members() {
					if ast.IsConstructorDeclaration(member) && member.Flags&ast.NodeFlagsReparsed != 0 {
						p.fieldlessErrorConstructors[member] = true
					}
				}
			}
			if isLowerable(node) && (a.isEffect(node) || a.onPlainCycle(node)) {
				if isLambda(node) && a.finalForm(node) == formProgram {
					p.programs[node] = true
				} else {
					p.effects[node] = true
				}
				p.parameterWrites[node] = writesParameters(c, node)
				p.planClause(c, node)
				p.planProducer(c, node)
				forEachCallInBody(node, func(call *ast.Node) bool {
					if a.runs(call) || a.isCycleCall(call) {
						p.runs[call] = true
					}
					if ast.IsCallExpression(call) {
						p.planServiceCall(c, call)
						p.planResume(c, call)
					}
					return false
				})
				p.planScopes(a, node)
			}
			if a.returnedProgram(node) != nil {
				p.returns[node] = true
			}
			if conversion := a.finalConversion(node); conversion == convertProgram || conversion == convertSyncProgram || conversion == convertPrograms || conversion == convertByName {
				p.converts[node] = conversion
				if conversion == convertByName {
					byNameResults(byNameSubject(node), func(result *ast.Node) {
						p.heldPrograms[result] = a.heldPrograms[result]
					})
				}
			}
			// A by-name expression has its own Effect body even when the
			// enclosing factory stays plain. Plan the calls that body runs.
			if isInvocation(node) && a.byNameOf(node) != nil {
				if a.runs(node) {
					p.runs[node] = true
				}
				if ast.IsCallExpression(node) {
					p.planServiceCall(c, node)
					p.planResume(c, node)
				}
			}
			if form, ok := hatchFormOf(c, node); ok {
				p.hatches[node] = form
			}
			if isFailureTest(node) {
				p.failureTags[node], _ = failureTags(c, c.GetTypeFromTypeNode(node.TypeArguments()[0]))
			}
			if ast.IsCallExpression(node) && ast.IsPropertyAccessExpression(node.Expression()) {
				if call, ok := methodCallOf(c, node.Expression()); ok {
					p.methods[node] = call
				}
			}
			if isPipe(node) {
				p.planPipe(a, node)
			}
			p.planPlain(a, node)
			p.planJoins(a, node) // D340 (joined.go)
			p.planServiceNode(c, node)
			if p.wireOrders[node] != nil || fiberHelper(node) == "$forConcurrent" {
				p.noteStable(c, node.Arguments()...) // arguments emitted in another order (order.go)
				for _, layer := range p.wireLists[node] {
					p.noteStable(c, layer.node) // a layer a spread lists (wire.go)
				}
			}
			p.planAcquisitionReference(c, node)
			p.planExhaustiveMatch(c, node) // D294 (match_lower.go)
			p.planVariantTest(c, node)     // D307 (data_lower.go)
			node.ForEachChild(visit)
			return false
		}
		file.AsNode().ForEachChild(visit)
		p.prelude = p.withoutUnusedNoMatch(p.prelude)
		p.prelude = p.withoutUnusedIs(p.prelude)
		// The lowering writes try e as yield* e or e (try.go), never a call of $try.
		p.prelude = core.Filter(p.prelude, func(name string) bool { return name != "$try" })
		p.planTrustedCalls(c, a, file)
		p.entry = planEntry(c, file)
		p.planSpans(c, file)
	})
	return p
}

// forEachCallInBody calls cb for each call that fn's own body evaluates,
// skipping nested functions and classes, until cb returns true. It reports
// whether cb returned true.
func forEachCallInBody(fn *ast.Node, cb func(call *ast.Node) bool) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if isInvocation(node) && cb(node) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(fn.Body())
}

// forEachRunningCallInBody excludes expressions passed by name (D147).
// Constructing a cold program does not make its enclosing factory effectful.
// Lowering still uses forEachCallInBody to plan the deferred program itself.
func (a *analyzer) forEachRunningCallInBody(fn *ast.Node, cb func(*ast.Node) bool) bool {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) || a.isByName(node) {
			return false
		}
		if isInvocation(node) && cb(node) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(fn.Body())
}

type fnState uint8

const (
	stateUnknown fnState = iota
	stateVisiting
	statePure
	stateEffect
)

// analyzer decides which .vibe functions are Effects. A function is an Effect
// when its body runs a call, a call whose signature returns an Effect or a
// call to a .vibe function that is itself an Effect, or when a throw can end
// it. A function on a call cycle is an Effect, which is always correct and
// only slower than solving the cycle. Every other function compiles to plain
// JavaScript (design D10).
type analyzer struct {
	checker       *checker.Checker
	states        map[*ast.Node]fnState
	effects       map[*ast.Node]*effectInfo // see effectOf
	approx        map[*ast.Node]*effectInfo // the E and R found so far of a call cycle being solved (recursion.go)
	recursive     map[*ast.Node]bool        // functions on a call cycle
	connecting    map[*ast.Node]bool        // functions solve is discovering the callees of, until their component is solved (recursion.go)
	reentered     map[*ast.Node]bool        // functions whose E and R were read while their callees were being discovered
	tryBlocks     map[*ast.Node]*effectInfo // see tryBlockFlow
	factories     map[factoryKey]fnState
	factoryActive map[*ast.Node]bool
	contracts     map[*ast.Node]*contract // see contractOf

	// Lambda forms (forms.go).
	lambdas         map[*ast.Node]*lambdaState
	current         map[*ast.Node][]*checker.Signature  // call -> candidates its arguments are being checked against
	rejected        map[*ast.Node]map[candidateKey]bool // call -> candidates a lambda argument rejected
	resolving       map[*ast.Node]bool                  // calls whose signature candidateOf is resolving
	effectInterface *checker.Type                       // the generic Effect interface, once seen

	conversions      map[*ast.Node]*valueState   // argument expressions that convert (conversions.go)
	heldPrograms     map[*ast.Node]bool          // by-name result values before argument conversion
	returnedPrograms map[*ast.Node]*checker.Type // structured programs at Effect return boundaries
	valueTyping      map[*ast.Node]bool          // by-name arguments whose own type is being read (valueTypeOf)
	classifying      map[*ast.Node]bool          // values whose position is being classified (expressionType)
	keywordValues    map[*ast.Node]*checker.Type // keyword operands' values (keywords.go)

	// Plain JavaScript functions (plain.go).
	plain                 map[*ast.Node]plainState  // function declarations that compile to plain JavaScript
	plainEdges            map[*ast.Node][]plainEdge // $direct calls in a function's own body (plain_cycles.go)
	plainCycles           map[*ast.Node]bool        // plain functions on a cycle of $direct calls
	programEffect         *checker.Type             // effect's Effect interface, found in the program's files
	programEffectSearched bool

	// Scope regions (scopes.go).
	programScopeType     *checker.Type // effect's Scope interface, found in the program's files
	programScopeSearched bool
}

type analyzerKey struct{}

// analyzerFor returns the analyzer that remembers c's answers. It lives on c,
// so it is freed with c. A checker is used by one goroutine at a time, so its
// analyzer needs no lock of its own.
func analyzerFor(c *checker.Checker) *analyzer {
	return c.ExtensionState(analyzerKey{}, func() any {
		return &analyzer{
			checker:       c,
			states:        map[*ast.Node]fnState{},
			effects:       map[*ast.Node]*effectInfo{},
			approx:        map[*ast.Node]*effectInfo{},
			recursive:     map[*ast.Node]bool{},
			connecting:    map[*ast.Node]bool{},
			reentered:     map[*ast.Node]bool{},
			tryBlocks:     map[*ast.Node]*effectInfo{},
			contracts:     map[*ast.Node]*contract{},
			factories:     map[factoryKey]fnState{},
			factoryActive: map[*ast.Node]bool{},
			lambdas:       map[*ast.Node]*lambdaState{},
			current:       map[*ast.Node][]*checker.Signature{},
			rejected:      map[*ast.Node]map[candidateKey]bool{},
			resolving:     map[*ast.Node]bool{},

			conversions:      map[*ast.Node]*valueState{},
			heldPrograms:     map[*ast.Node]bool{},
			returnedPrograms: map[*ast.Node]*checker.Type{},
			valueTyping:      map[*ast.Node]bool{},
			classifying:      map[*ast.Node]bool{},
			keywordValues:    map[*ast.Node]*checker.Type{},
			plain:            map[*ast.Node]plainState{},
			plainEdges:       map[*ast.Node][]plainEdge{},
			plainCycles:      map[*ast.Node]bool{},
		}
	}).(*analyzer)
}

func (a *analyzer) isEffect(fn *ast.Node) bool {
	if a.isFactory(fn) {
		return false
	}
	if isProducer(fn) {
		return true // its body is an Effect body; calling it returns a Stream
	}
	if isLambda(fn) {
		return a.finalForm(fn) != formPlain
	}
	if isWrittenForm(fn) {
		// D500: a function's form is written. Without a return annotation it
		// is an Effect function, whatever its body does; with one that is not
		// an Effect, or with `infer _`, it is plain.
		return !a.hasPlainContract(fn)
	}
	switch a.states[fn] {
	case stateVisiting:
		// A call that reaches fn again while its body is read, as a recursive
		// size(): number method's this.next.size() does, is plain when fn has
		// a plain return annotation: the annotation names its form (rule F),
		// as D56's fixpoint counts a plain candidate's own cycle, and a body
		// that runs an Effect is EK2003 at the annotation.
		return !a.hasPlainContract(fn)
	case stateEffect:
		return true
	case statePure:
		return false
	}
	a.states[fn] = stateVisiting
	effect := a.forEachRunningCallInBody(fn, a.performs) || a.expectsEffect(fn) && !a.hasPlainContract(fn) || hasEscapingThrow(fn) || a.hasEscapingFailure(fn) || a.hasContract(fn) || declaresUsing(fn) || hasVibeLangStatement(fn) || a.hasStreamLoop(fn)
	a.states[fn] = core.IfElse(effect, stateEffect, statePure)
	return effect
}

// isWrittenForm reports whether fn is a .vibe function whose form its
// declaration writes (D500): a function declaration or a method. A class's
// constructor, accessors, and static blocks run as plain JavaScript (D282).
func isWrittenForm(fn *ast.Node) bool {
	return (fn.Kind == ast.KindFunctionDeclaration || fn.Kind == ast.KindMethodDeclaration) && isLowerable(fn) && !isProducer(fn)
}

// performs reports whether call performs an Effect operation: it runs an
// Effect, calls an Effect function through its plain variant, or looks up a
// service.
func (a *analyzer) performs(call *ast.Node) bool {
	return a.runs(call) || a.runsVariant(call) || ast.IsCallExpression(call) && !holdsProgram(a.checker, call) && isServiceLookup(a.checker, call)
}

// runsVariant reports whether call calls an Effect function through its plain
// variant (D421). It runs no Effect, but its callee is an Effect function,
// which plain code may not call (D500): EK1001, EK2003, or EK4301.
func (a *analyzer) runsVariant(call *ast.Node) bool {
	if inHatch(call) || holdsProgram(a.checker, call) {
		return false
	}
	sig := a.checker.GetResolvedSignature(call)
	if sig == nil {
		return false
	}
	fn := implementationOf(sig.Declaration())
	return fn != nil && isLowerable(fn) && a.isSplittable(fn) && a.isPlainFunction(fn)
}

// runs reports whether call runs an Effect, which the lowering spells yield*.
func (a *analyzer) runs(call *ast.Node) bool {
	if inHatch(call) || holdsProgram(a.checker, call) {
		return false // hatches and declared program positions keep the Effect value
	}
	sig := a.callSignature(call)
	if sig == nil {
		return false
	}
	if fn := implementationOf(sig.Declaration()); fn != nil && isLowerable(fn) {
		if isProducer(fn) {
			return false // a call constructs the producer's Stream and runs none of it
		}
		if a.isPlainFunction(fn) && a.isSplittable(fn) {
			// A plain function's call runs inline, through its $direct
			// variant when it has one, and runs its Effect form only where
			// that variant is out of reach.
			return a.directReferenceOf(ast.GetInvokedExpression(call), fn) == nil
		}
		// D269 factories run their returned program; D67 Effect arrows retain their API.
		if a.isFactory(fn) || a.isEffect(fn) {
			return true // body inference may still be computing the signature's type
		}
		// A plain factory can return a cold Effect stored in a local. The
		// callee's form does not decide whether that returned program runs.
	}
	return callRunsResult(a.checker, call, a.callReturnType(sig))
}

// callSignature is the signature call resolves to. The call of a do or throw
// expression's function, while the checker infers that function's return
// type, gives the function's own signature: resolving the call again there
// would type the function again, a cycle (TS7022, TS7024). A catch binding of
// a try block that holds `return do { ... }` reaches it that way, typed while
// a written contract decides the return's contextual type.
func (a *analyzer) callSignature(call *ast.Node) *checker.Signature {
	if sig := a.resolvingProgramCall(call); sig != nil {
		return sig
	}
	return a.checker.GetResolvedSignature(call)
}

// resolvingProgramCall returns the signature of the function call invokes
// when call is a do or throw expression whose return type the checker is
// inferring, and nil otherwise.
func (a *analyzer) resolvingProgramCall(call *ast.Node) *checker.Signature {
	if call.Kind != ast.KindCallExpression || len(call.Arguments()) != 0 {
		return nil
	}
	fn := ast.SkipParentheses(call.Expression())
	if !isProgramArrow(fn) {
		return nil
	}
	if sig := a.checker.GetSignatureFromDeclaration(fn); a.checker.IsResolvingReturnTypeOf(sig) {
		return sig
	}
	return nil
}

// callReturnType is the return type of sig. A do or throw expression's
// function, whose return type the checker is inferring right now, gives the
// union of the values it completes with instead (callSignature).
func (a *analyzer) callReturnType(sig *checker.Signature) *checker.Type {
	fn := sig.Declaration()
	if !isProgramArrow(fn) || !a.checker.IsResolvingReturnTypeOf(sig) {
		return a.checker.GetReturnTypeOfSignature(sig)
	}
	var values []*checker.Type
	factoryReturns(fn, func(expr *ast.Node) {
		if expr != nil {
			values = append(values, a.checker.GetTypeAtLocation(expr))
		}
	})
	return a.checker.GetUnionType(values)
}

// implementationOf returns the function body that decl resolves to, which
// differs from decl when decl is an overload signature.
func implementationOf(decl *ast.Node) *ast.Node {
	if decl == nil || decl.Kind != ast.KindFunctionDeclaration || decl.Body() != nil {
		return decl
	}
	if symbol := decl.Symbol(); symbol != nil {
		for _, d := range symbol.Declarations() {
			if d.Kind == ast.KindFunctionDeclaration && d.Body() != nil {
				return d
			}
		}
	}
	return decl
}

// isEffectType reports whether t is effect's own Effect interface,
// Effect<A, E, R>, or a union consisting entirely of that interface (D270).
// Types that extend it, such as Config, Exit, Context keys,
// and TaggedError instances, are data: a call that returns one does not run
// it (design D24).
func isEffectType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isEffectType(c, member) {
				return false
			}
		}
		return len(t.Types()) > 0
	}
	if t.Flags()&checker.TypeFlagsObject == 0 || t.Symbol() == nil {
		return false
	}
	return effectInterfaceSymbol(c, t) == t.Symbol()
}

// effectInterfaceSymbol returns the symbol of the interface named Effect that
// declares t's `~effect/Effect` property, or nil if t has no such property.
func effectInterfaceSymbol(c *checker.Checker, t *checker.Type) *ast.Symbol {
	property := c.GetPropertyOfType(t, effectTypeID)
	if property == nil {
		return nil
	}
	for _, decl := range property.Declarations() {
		if parent := decl.Parent; parent != nil && ast.IsInterfaceDeclaration(parent) && parent.Name().Text() == "Effect" {
			return c.GetSymbolOfDeclaration(parent)
		}
	}
	return nil
}
