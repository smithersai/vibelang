package vibelangmapper

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Purity: what a top-level function's body says from syntax alone about
// how its calls run. Two answers per function:
//
//   - ProvablyPure: the body behaves the same as plain JavaScript and as an
//     Effect body. It calls only provably pure functions of the same file
//     and pure globals (Math.max, Number, JSON.stringify), and has no escaping throw,
//     yield, await, using, for...of, this, arguments, or VibeLang syntax.
//     D54 also permits locally caught shipped failures with a proven native
//     body; every catch unwraps expected failures and rethrows defects.
//     The executable rendering compiles such a function to f$direct and its
//     Effect wrapper (D10), and a same-file call of it costs what a
//     JavaScript call costs.
//   - PlainLooking: the body runs no Effect it can name. It has none of the
//     forms above but calls and for...of, and each call is either provably
//     pure or of unknown purity: a method of a value (xs.at(0)), a function
//     of another file, an unknown global, a plain-annotated function, or a
//     same-file function that looks plain itself. A for...of counts as of
//     unknown purity too, since it runs its value when the value is a
//     Stream. A call that names an Effect, such as Effect.log(...), a member
//     of a service the file declares, or a prelude operation such as fork,
//     is not plain.
//
// A function that looks plain but is not provably pure runs through the
// fast-call protocol, about 20 ns a call against the direct path's 3 ns;
// a plain return annotation (L2) makes it plain JavaScript. 4a's language
// server warns exactly there (PlainLooking && !ProvablyPure), never on code
// that runs Effects.
//
// Both answers are greatest fixpoints over the file's functions, so a group
// of functions that call only one another is pure, or plain-looking,
// together, as D56 decides for the fork.

// FunctionPurity is purity's answer for one top-level Effect function.
type FunctionPurity struct {
	// Name is the function's name.
	Name string
	// Start and End span the declaration, from its first token; NameStart
	// and NameEnd span its name, where a warning goes.
	Start, End         int
	NameStart, NameEnd int
	ProvablyPure       bool
	PlainLooking       bool
}

// An obstacle is the worst thing a body's syntax holds for purity.
type obstacle uint8

const (
	// obstacleNone: plain JavaScript, the same in either body.
	obstacleNone obstacle = iota
	// obstacleUnknown: a call or a for...of whose purity syntax cannot tell.
	obstacleUnknown
	// obstacleBlocking: anything else that is not plain: an Effect it names,
	// a throw, a try, a yield, an await, a using, this, arguments, or
	// VibeLang syntax.
	obstacleBlocking
)

// effectOperations are the prelude names whose calls are Effect operations:
// D151's Effect functions and the runtime's fibers, handlers, hatches, and
// runners (prelude.d.ts).
var effectOperations = setOf(`all die exit forEach log logDebug logError logInfo logWarning race repeat retry sleep timeout withSpan
	fork handle resume resumeWith abandon sync callback runPromise runFork runSync runCallback detach forkIn interrupt yieldNow
	uninterruptible restore interruptible try attempt suspend handoff`)

// effectModules conservatively covers modules with Effect-returning call
// signatures in effect@4.1.0's root exports. Derived from dist/index.d.ts by
// inspecting each exported module's callable exports (including curried
// return signatures), rather than selecting only familiar Effect modules.
// A module can also have plain members; without types we must not recommend
// a plain annotation for a call that could run an Effect.
var effectModules = setOf(`Arbitrary Cache Cause Channel Clock ConfigProvider Console DateTime Deferred Effect Effectable
	ErrorReporter Fiber FiberHandle FiberMap FiberSet Filter Latch Layer LayerMap LayerRef LogLevel Logger Metric
	PartitionedSemaphore Pool PubSub Pull Queue Random RcMap RcRef Ref Request RequestResolver Resource Schedule Schema
	SchemaGetter SchemaParser Scope ScopedCache ScopedRef Semaphore Stream SubscriptionRef SynchronizedRef TxChunk
	TxDeferred TxHashMap TxHashSet TxPriorityQueue TxPubSub TxQueue TxReentrantLock TxRef TxSemaphore TxSubscriptionRef`)

// purity returns the purity of each top-level function that the plan
// lowers as an Effect function and that is the file's only declaration of
// its name, in source order: the functions the executable rendering
// decides how to compile. A function with a plain return annotation is
// plain already, and an overloaded or shadowed one keeps the Effect form,
// so neither is listed.
func (p *projector) purity() []FunctionPurity {
	var functions []*ast.Node
	index := map[string]int{}
	declarations := p.purityDeclarations()
	for _, statement := range p.file.Statements.Nodes {
		if !isProjectedFunction(statement) || statement.Name() == nil || ast.HasSyntacticModifier(statement, ast.ModifierFlagsAmbient) {
			continue
		}
		name := statement.Name().Text()
		if declarations[name] != 1 || !p.hasEffectBody(statement) {
			continue
		}
		index[name] = len(functions)
		functions = append(functions, statement)
	}
	plain := make([]bool, len(functions))
	pure := make([]bool, len(functions))
	for i := range functions {
		plain[i], pure[i] = true, true
	}
	callee := func(name string) (obstacle, bool) {
		i, ok := index[name]
		switch {
		case !ok:
			return obstacleUnknown, false
		case pure[i]:
			return obstacleNone, true
		case plain[i]:
			return obstacleUnknown, true
		}
		return obstacleBlocking, true
	}
	// PlainLooking first, then ProvablyPure within it; each loop removes
	// functions until nothing changes.
	for changed := true; changed; {
		changed = false
		for i, fn := range functions {
			if plain[i] && p.bodyObstacle(fn, callee) == obstacleBlocking {
				plain[i], pure[i], changed = false, false, true
			}
		}
	}
	for changed := true; changed; {
		changed = false
		for i, fn := range functions {
			if pure[i] && (p.bodyObstacle(fn, callee) != obstacleNone || !p.plainEdits(fn)) {
				pure[i], changed = false, true
			}
		}
	}
	result := make([]FunctionPurity, len(functions))
	for i, fn := range functions {
		name := fn.Name()
		result[i] = FunctionPurity{
			Name:         name.Text(),
			Start:        p.tokenStart(fn),
			End:          fn.End(),
			NameStart:    p.tokenStart(name),
			NameEnd:      name.End(),
			ProvablyPure: pure[i],
			PlainLooking: plain[i],
		}
	}
	return result
}

// purityDeclarations counts bindings, excluding export specifiers, which
// reference existing bindings. Keep this local to purity: projection still
// uses names' conservative accounting for its other decisions.
func (p *projector) purityDeclarations() map[string]int {
	counts := map[string]int{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindIdentifier && node.Flags&ast.NodeFlagsReparsed == 0 &&
			!isMemberName(node) && ast.IsDeclarationName(node) &&
			node.Parent.Kind != ast.KindShorthandPropertyAssignment && node.Parent.Kind != ast.KindExportSpecifier {
			counts[node.Text()]++
		}
		node.ForEachChild(visit)
		return false
	}
	p.file.AsNode().ForEachChild(visit)
	return counts
}

// hasEffectBody reports whether the plan lowers fn's body as an Effect
// function's: an Effect body edit right after its brace, or a contract
// (D57) that closes after it.
func (p *projector) hasEffectBody(fn *ast.Node) bool {
	if p.forms.(*Resolver).isFactory(fn) {
		return false
	}
	body := fn.Body()
	open, end := p.tokenStart(body)+1, body.End()
	for _, e := range p.plan.edits {
		if e.kind == editEffectBody && e.part == partOpen && e.pos == open || e.kind == editContract && e.part == partClose && e.pos == end {
			return true
		}
	}
	return false
}

// plainEdits reports whether every edit in fn's body, other than its own
// Effect body's, is a call that runs or syntax, so the plan lowers no form
// in it some other way. Nested functions count: their own Effect bodies
// make the body not provably pure, as the executable rendering decides.
func (p *projector) plainEdits(fn *ast.Node) bool {
	if p.plainBuiltinBodies[fn] != nil {
		return true
	}
	body := fn.Body()
	lo, hi := p.tokenStart(body)+1, body.End()-1
	for _, e := range p.plan.edits {
		if e.pos < lo || e.pos > hi {
			continue
		}
		if e.kind == editEffectBody && (e.pos == lo && e.part == partOpen || e.pos == hi && e.part == partClose) {
			continue // fn's own body
		}
		// S5-1: a returned program must run even without a call in the body.
		if e.kind == editRun && e.arg == "return" {
			return false
		}
		if e.kind != editRun && e.kind != editSyntax {
			return false
		}
	}
	return true
}

// bodyObstacle returns the worst obstacle in fn's body, outside the
// functions and classes nested in it, except immediately invoked functions
// whose bodies execute here. callee answers for a call of a name:
// the obstacle a same-file function's call is, and whether the name is one.
func (p *projector) bodyObstacle(fn *ast.Node, callee func(name string) (obstacle, bool)) obstacle {
	if p.plainBuiltinBodies[fn] != nil {
		return obstacleNone
	}
	worst := obstacleNone
	var visit func(node *ast.Node) bool // true: stop, the body is blocked
	visit = func(node *ast.Node) bool {
		raise := func(o obstacle) bool {
			worst = max(worst, o)
			return worst == obstacleBlocking
		}
		if node.Flags&(ast.NodeFlagsVibeLang|ast.NodeFlagsReparsed) != 0 {
			return raise(obstacleBlocking)
		}
		switch node.Kind {
		case ast.KindThisKeyword, ast.KindSuperKeyword, ast.KindThrowStatement, ast.KindTryStatement,
			ast.KindYieldExpression, ast.KindAwaitExpression:
			return raise(obstacleBlocking)
		case ast.KindIdentifier:
			if node.Text() == "arguments" {
				return raise(obstacleBlocking)
			}
		case ast.KindVariableDeclarationList:
			if node.Flags&ast.NodeFlagsUsing != 0 {
				return raise(obstacleBlocking)
			}
		case ast.KindForOfStatement:
			if node.AsForInOrOfStatement().AwaitModifier != nil {
				return raise(obstacleBlocking)
			}
			raise(obstacleUnknown)
		case ast.KindTaggedTemplateExpression:
			raise(obstacleUnknown)
		case ast.KindCallExpression:
			target := ast.SkipParentheses(node.Expression())
			if target.Kind == ast.KindArrowFunction || target.Kind == ast.KindFunctionExpression {
				// An IIFE's body executes in this call; uncalled closures
				// below still do not affect PlainLooking.
				if visit(target.Body()) {
					return true
				}
			} else if raise(p.callObstacle(node, callee)) {
				return true
			}
		}
		if ast.IsFunctionLike(node) || ast.IsClassLike(node) {
			return false
		}
		return node.ForEachChild(visit)
	}
	fn.Body().ForEachChild(visit)
	return worst
}

// callObstacle classifies one call of a body (purity's comment).
func (p *projector) callObstacle(call *ast.Node, callee func(name string) (obstacle, bool)) obstacle {
	if p.builtinFailure(call) != "" {
		return obstacleBlocking
	}
	if p.isPureGlobal(call) {
		return obstacleNone
	}
	target := call.Expression()
	switch target.Kind {
	case ast.KindIdentifier:
		name := target.Text()
		if o, ok := callee(name); ok {
			if call.QuestionDotToken() != nil {
				return max(o, obstacleUnknown)
			}
			return o
		}
		if len(call.Arguments()) == 0 && p.mayBeServiceKey(target) {
			return obstacleBlocking // D90: calling a key reads its service
		}
		if effectOperations[name] && (p.isPreludeName(name) || p.isEffectImport(name)) {
			return obstacleBlocking
		}
	case ast.KindPropertyAccessExpression:
		receiver := target.Expression()
		if receiver.Kind == ast.KindIdentifier {
			name := receiver.Text()
			if p.isEffectImport(name) || effectModules[name] && p.isPreludeName(name) {
				return obstacleBlocking
			}
			if p.mayBeServiceKey(receiver) {
				// D41: a member of a possible service key reads the service.
				// A class with static members looks the same; it gets no
				// warning, which errs toward silence.
				return obstacleBlocking
			}
		}
	}
	return obstacleUnknown
}

// pureGlobalObjects and pureGlobalFunctions are JavaScript globals whose
// calls never return an Effect and run no Effect, so a call of one runs the
// same in plain JavaScript and in an Effect body. A file that declares the
// name shadows it.
var pureGlobalObjects = setOf(`Math Number JSON`)
var pureGlobalFunctions = setOf(`String Number Boolean parseInt parseFloat isNaN isFinite`)
var pureGlobalMembers = map[string]map[string]bool{
	"Object": setOf(`keys values entries`),
	"Array":  setOf(`isArray`),
	"String": setOf(`fromCharCode fromCodePoint`),
}

// isPureGlobal reports whether call calls a pure global that no
// declaration of the file shadows.
func (p *projector) isPureGlobal(call *ast.Node) bool {
	if call.QuestionDotToken() != nil {
		return false
	}
	target := call.Expression()
	switch target.Kind {
	case ast.KindIdentifier:
		return pureGlobalFunctions[target.Text()] && !p.names.declared[target.Text()]
	case ast.KindPropertyAccessExpression:
		receiver := target.Expression()
		if receiver.Kind != ast.KindIdentifier || target.QuestionDotToken() != nil || p.names.declared[receiver.Text()] {
			return false
		}
		return pureGlobalObjects[receiver.Text()] || pureGlobalMembers[receiver.Text()][target.Name().Text()]
	}
	return false
}

// isPreludeName reports whether name, written in the file, means the
// prelude's export: no declaration of the file declares it.
func (p *projector) isPreludeName(name string) bool {
	return preludeNames[name] && !p.names.declared[name] && !p.names.topLevel[name]
}

// isEffectImport reports whether name is imported from effect, one of its
// modules, an @effect package, or vibelang-runtime, and nothing else of the file declares it.
func (p *projector) isEffectImport(name string) bool {
	from, ok := p.names.importedFrom[name]
	return ok && (from == "effect" || strings.HasPrefix(from, "effect/") || strings.HasPrefix(from, "@effect/") || from == "vibelang-runtime") && p.names.declarations[name] == 1
}
