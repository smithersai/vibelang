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
	collisionModules map[*ast.Node]string

	parameterWrites map[*ast.Node]bool // Effect functions whose body writes a parameter binding

	fieldlessErrorConstructors map[*ast.Node]bool
	effects                    map[*ast.Node]bool // functions lowered to Effect.fnUntraced generators
	programs                   map[*ast.Node]bool // lambdas lowered to Effect.gen programs (design D7)
	runs                       map[*ast.Node]bool // calls in those functions emitted as yield*
	returns                    map[*ast.Node]bool // returned Effect subtypes executed at an Effect return boundary
	prelude                    []string           // prelude names the file uses as values (prelude.go)
	intrinsics                 map[*ast.Node]bool // intrinsics a source binding would capture, reached through the lowering's own import (prelude.go)
	servicePlan
	joinPlan
	trustedPlan
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

func (p *plan) isEffect(fn *ast.Node) bool   { return p.effects[fn] }
func (p *plan) isProgram(fn *ast.Node) bool  { return p.programs[fn] }
func (p *plan) runsCall(call *ast.Node) bool { return p.runs[call] }

// planFile asks the checker which functions in file are Effects and which of
// their calls run.
func planFile(resolver printer.EmitResolver, file *ast.SourceFile) *plan {
	p := newFilePlan()
	if r, ok := resolver.(*checker.EmitResolver); ok {
		r.WithChecker(func(c *checker.Checker) { populateFilePlan(c, file, p) })
	}
	return p
}

func newFilePlan() *plan {
	p := &plan{effects: map[*ast.Node]bool{}, programs: map[*ast.Node]bool{}, runs: map[*ast.Node]bool{}, servicePlan: newServicePlan(), trustedPlan: newTrustedPlan(), scopePlan: newScopePlan()}
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
	return p
}

// populateFilePlan uses the caller's checker lock. Emit and missing-dependency
// checking share the same lowering decisions rather than guessing from tokens.
func populateFilePlan(c *checker.Checker, file *ast.SourceFile, p *plan) {
	p.prelude = preludeUses(c, file)
	p.collisionModules = collisionModules(c)
	p.intrinsics = preludeStateOf(c).intrinsics
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
		if isLowerable(node) && a.isEffect(node) {
			if markedForm(node) == formProgram {
				p.programs[node] = true
			} else {
				p.effects[node] = true
			}
			p.parameterWrites[node] = writesParameters(c, node)
			p.planClause(c, node)
			p.planProducer(c, node)
			forEachCallInBody(node, func(call *ast.Node) bool {
				if a.runs(call) {
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
}

// forEachCallInBody calls cb for each call that fn's own body evaluates,
// skipping nested functions and classes, until cb returns true. It reports
// whether cb returned true. A function-like node without a body, a function
// type or an overload signature, evaluates no call.
func forEachCallInBody(fn *ast.Node, cb func(call *ast.Node) bool) bool {
	body := fn.Body()
	if body == nil {
		return false
	}
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
	return visit(body)
}

// forEachRunningCallInBody excludes expressions passed by name (D147).
// Constructing a cold program does not make its enclosing factory effectful.
// Lowering still uses forEachCallInBody to plan the deferred program itself.
func (a *analyzer) forEachRunningCallInBody(fn *ast.Node, cb func(*ast.Node) bool) bool {
	body := fn.Body()
	if body == nil {
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if isInvocation(node) && cb(node) {
			return true
		}
		return node.ForEachChild(visit)
	}
	return visit(body)
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
	checker    *checker.Checker
	states     map[*ast.Node]fnState
	effects    map[*ast.Node]*effectInfo // see effectOf
	approx     map[*ast.Node]*effectInfo // the E and R found so far of a call cycle being solved (recursion.go)
	recursive  map[*ast.Node]bool        // functions on a call cycle
	connecting map[*ast.Node]bool        // functions solve is discovering the callees of, until their component is solved (recursion.go)
	reentered  map[*ast.Node]bool        // functions whose E and R were read while their callees were being discovered
	tryBlocks  map[*ast.Node]*effectInfo // see tryBlockFlow
	contracts  map[*ast.Node]*contract   // see contractOf
	runsAsked  map[*ast.Node]bool        // calls runs is resolving (resolvedRunsResult)

	// Lambda forms (forms.go).
	lambdas         map[*ast.Node]*lambdaState
	effectInterface *checker.Type // the generic Effect interface, once seen

	returnedPrograms map[*ast.Node]*checker.Type // structured programs at Effect return boundaries
	valueTyping      map[*ast.Node]bool          // by-name arguments whose own type is being read (valueTypeOf)
	classifying      map[*ast.Node]bool          // values whose position is being classified (expressionType)
	keywordValues    map[*ast.Node]*checker.Type // keyword operands' values (keywords.go)

	programEffect         *checker.Type // effect's Effect interface, found in the program's files
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
			checker:    c,
			states:     map[*ast.Node]fnState{},
			runsAsked:  map[*ast.Node]bool{},
			effects:    map[*ast.Node]*effectInfo{},
			approx:     map[*ast.Node]*effectInfo{},
			recursive:  map[*ast.Node]bool{},
			connecting: map[*ast.Node]bool{},
			reentered:  map[*ast.Node]bool{},
			tryBlocks:  map[*ast.Node]*effectInfo{},
			contracts:  map[*ast.Node]*contract{},
			lambdas:    map[*ast.Node]*lambdaState{},

			returnedPrograms: map[*ast.Node]*checker.Type{},
			valueTyping:      map[*ast.Node]bool{},
			classifying:      map[*ast.Node]bool{},
			keywordValues:    map[*ast.Node]*checker.Type{},
		}
	}).(*analyzer)
}

func (a *analyzer) isEffect(fn *ast.Node) bool {
	return markedForm(fn) != formNone || isProducer(fn)
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
	return a.runs(call) || ast.IsCallExpression(call) && !holdsProgram(a.checker, call) && isServiceLookup(a.checker, call)
}

// runsVariant reports whether call calls an Effect function through its plain
// variant (D421). It runs no Effect, but its callee is an Effect function,
// which plain code may not call (D500): EK1001, EK9203, or EK4301.
func (a *analyzer) runsVariant(call *ast.Node) bool {
	return false
}

// runs reports whether call runs an Effect, which the lowering spells yield*.
func (a *analyzer) runs(call *ast.Node) bool {
	if inHatch(call) {
		return false
	}
	if ast.IsCallExpression(call) {
		if fn := ast.SkipParentheses(call.Expression()); isCalledInPlace(fn) {
			return a.isEffect(fn) // a match or an is expression in effect code
		}
	}
	if catchExpressionOf(call) != nil {
		if isCatchLeftBody(call) {
			// a catch h1 catch h2 is (a catch h1) catch h2 (VIP-5): the
			// outer catch runs the inner one, which stays its Effect.
			return catchLeftRuns(call)
		}
		return inEffectCode(call) // e catch h runs e (VIP-5)
	}
	if isKeywordFormCall(call) || a.isFiberCall(call) {
		// fork e, join f, for concurrent, select and provide are each
		// exact sugar for an Effect that runs where the form stands, as
		// try e does (VIP-12, VIP-17, VIP-19).
		return inEffectCode(call) && !holdsProgram(a.checker, call) && a.resolvedRunsResult(call)
	}
	if catchLeftRuns(call) {
		return true
	}
	if !isTry(call) || !inEffectCode(call) {
		return false
	}
	// try S.member(…) runs the service lookup (D41), which the call does
	// in effect code with or without try; a member that returns no Effect
	// gives its value.
	return serviceLookup(a.checker, call) == nil || a.resolvedRunsResult(call)
}

// resolvedRunsResult reports whether call returns an Effect, which it then
// runs: a keyword form, or try on a service member call. The checker asks
// runs while it resolves call (its inference target hook); that nested
// question is answered no, and the resolution the outer question started
// completes.
func (a *analyzer) resolvedRunsResult(call *ast.Node) bool {
	if a.runsAsked[call] {
		// join f and fork e always give an Effect. Resolving one can type
		// the call around it first (seen.push(join f) in a for concurrent
		// body, whose callback the checker types for inference), which
		// types the join itself: answering no there kept the Effect as
		// the join's type (TS2345).
		return a.givesFiberEffect(call)
	}
	a.runsAsked[call] = true
	defer delete(a.runsAsked, call)
	sig := a.callSignature(call)
	return sig != nil && callRunsResult(a.checker, call, a.callReturnType(sig))
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

// isEffectAnnotation reports whether the type node t names an Effect.
func (a *analyzer) isEffectAnnotation(t *ast.Node) bool {
	return isEffectType(a.checker, a.checker.GetTypeFromTypeNode(t))
}

// programEffectInterface returns the generic Effect interface that effect's
// Effect module declares, or nil when the program does not include effect.
// Unlike an Effect found in some type on the way, it does not depend on the
// order in which the checker checks things.
func (a *analyzer) programEffectInterface() *checker.Type {
	if a.programEffectSearched {
		return a.programEffect
	}
	a.programEffectSearched = true
	for _, file := range a.checker.Program().SourceFiles() {
		if !isEffectModuleFile(file, "Effect") || file.Symbol == nil {
			continue
		}
		for _, export := range a.checker.GetExportsOfModule(file.Symbol) {
			if export.Name() == "Effect" && export.Flags()&ast.SymbolFlagsInterface != 0 {
				a.programEffect = a.checker.GetDeclaredTypeOfSymbol(export)
				return a.programEffect
			}
		}
	}
	return nil
}

// isFiberCall reports whether call is fork(e) or join(f), a call of the
// runtime's fork or join. In effect code fork and join are reserved as await
// is in an async body, so join(parts) joins and fork(e) forks e, as join parts
// and fork e do (VIP-17, "reserved in effect code").
func (a *analyzer) isFiberCall(call *ast.Node) bool {
	if !ast.IsCallExpression(call) || call.QuestionDotToken() != nil {
		return false
	}
	callee := ast.SkipParentheses(call.Expression())
	return isRuntimeExport(a.checker, callee, "fork") || isRuntimeExport(a.checker, callee, "join")
}

// givesFiberEffect reports whether call is join f or fork e, as a keyword or
// as a call of the runtime's join or fork, whose result is always an Effect.
func (a *analyzer) givesFiberEffect(call *ast.Node) bool {
	if fiberHelper(call) == "$join" || a.isFiberCall(call) {
		return true
	}
	callee := ast.SkipParentheses(call.Expression())
	return ast.IsIdentifier(callee) && callee.Text() == "fork" && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}

// isKeywordFormCall reports whether call is a call the parser writes for a
// keyword form: its callee is an intrinsic, which means the prelude's export
// whatever the file declares (prelude.go). $try(e), the parser's call for
// try e, is not one: try runs e by its own rule (runs), which needs no
// resolved signature, so the checker types it the same whether or not it is
// resolving the call around it.
func isKeywordFormCall(call *ast.Node) bool {
	if !ast.IsCallExpression(call) || isTryCall(call) {
		return false
	}
	callee := ast.SkipParentheses(call.Expression())
	return ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0
}
