package vibelangmapper

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The executable rendering: the plan rendered as the code that runs. Its
// semantics are the checking rendering's; only the way a call runs differs,
// so that the JavaScript is fast where the virtual TypeScript only types.
//
//   - A call that runs tests its value at run time instead of yielding it
//     unconditionally (L3): (($t = c), $isRun($t) ? (yield* $t) : $t).
//   - A top-level function whose body is provably pure from syntax (D10,
//     execFunction.pure) compiles to f$direct, plain JavaScript, plus f, the
//     Effect wrapper, with f[$direct] = f$direct. A same-file call that runs
//     calls f$direct; a call of a function imported from another module looks
//     the property up, so no type from another file is needed.
//   - Any other top-level Effect function compiles to its generator, f$body,
//     the wrapper f, and a hoisted fast entry f$fast. Only entries on a
//     same-file fast-call cycle use $fast(f$body) to count eager depth.
//   - A function in value position is always the wrapper f (L2): the name f
//     keeps its meaning, so xs.map(double) passes the Effect function, as the
//     virtual TypeScript types it.
//
// The rendering itself, renderExec, maps one edit to text and knows nothing
// of the file. The lowering pass before it, execLowering, makes the
// file-level decisions (which functions split, which calls are direct) and
// records them as edits of their own, so the rendering stays one function of
// one edit.

// renderExec returns the executable text of e, with helper references
// unresolved, or keep false to leave e out. It is the default for each kind;
// the lowering pass rewrites the edits whose text depends on the file.
func renderExec(e edit) (text string, keep bool) {
	t, s := helperRef("$t"), helperRef("$s")
	switch e.kind {
	case editPatternFlow:
		return e.fields[1], true
	case editRegionVar:
		return e.fields[1], true
	case editHatch:
		return e.arg, true
	case editDataMethod:
		if len(e.fields) > 0 {
			// Only execution supplies dispatch candidates. In particular, a
			// checking predicate witness keeps its original argument tuple.
			return strings.Replace(e.arg, "]", "], "+helperRef("$methodCandidates_"+e.fields[0]), 1), true
		}
		return e.arg, true
	case editWitness:
		return "", false
	case editSyntax, editRegion, editDispatch:
		// A region, its completion records, and their dispatch run as the
		// checking rendering writes them: $end, $jump, $returned, and
		// $jumped have run-time definitions (execPrologue), and $box and
		// $unboxed are the identity, which resolves to nothing.
		return e.text, true
	case editRecord:
		switch e.arg {
		case "return value":
			// return x: the value itself is the completion.
			return pick(e.part, "return ", "", ""), true
		case "return":
			return "", true
		}
		return e.text, true
	case editRun:
		if e.arg == "return" {
			return pick(e.part, "(yield* "+helperRef("$returnRun")+"(", "", "))"), true
		}
		if e.arg == "service" {
			return pick(e.part, "(yield* ", "", ")"), true
		}
		// L3: an Effect runs, any other value is the call's value.
		return pick(e.part, "(("+t+" = ", "", "), "+helperRef("$isRun")+"("+t+") ? (yield* "+t+") : "+t+")"), true
	case editEffectBody:
		gen := generatorText(e.arg)
		switch {
		case strings.HasPrefix(e.arg, "expr"):
			// (x) => expr
			return pick(e.part, gen+"{ return ", "", " })"), true
		case strings.HasPrefix(e.arg, "block"):
			// a block param in the Effect function form
			return pick(e.part, "() => "+gen, "", ")"), true
		}
		// a function's braced body
		return pick(e.part, " return "+gen+"{", "", "})"), true
	case editContract:
		// The contract's slots stay in a return annotation, which the
		// transpiler erases: f(p): $Contract<A, $Infer, R> { return $gen(...) }.
		gen := helperRef("$gen") + "(function* () "
		if e.arg == "self" {
			gen = helperRef("$gen") + "({ self: this }, function* () "
		}
		return pick(e.part, ": $Contract<", "> { return "+gen, ")}"), true
	case editProgram:
		if strings.HasPrefix(e.arg, "expr") {
			return pick(e.part, generatorText(e.arg)+"{ return ", "", " })"), true
		}
		return pick(e.part, generatorText(e.arg), "", ")"), true
	case editDual:
		// L1's dual: the program, also a function that returns it.
		return pick(e.part, helperRef("$dual")+"(", "", ")"), true
	case editScoped:
		// Only the fork sees the block's private Scope (D19); ordinary
		// scoped operations in the block still belong to the caller.
		return pick(e.part, helperRef("$provideScope")+"(", "", ", "+helperRef("$scope")+")"), true
	case editProgramValue:
		// D7: a function value at a program position runs as its program.
		helper := "$asProgram"
		if e.arg == "collection" {
			helper = "$programs"
		} else if e.arg == "plain" {
			helper = "$sync"
		}
		return pick(e.part, helperRef(helper)+"(", "", ")"), true
	case editProducer:
		// D26: the runtime's $produce takes the body as a function that
		// returns its Effect, and runs it under its Yield handler.
		return pick(e.part, " return "+helperRef("$produce")+"(() => "+strings.Replace(generatorText(e.arg), helperRef("$gen"), helperRef("$producerGen"), 1)+"{", "", "}))"), true
	case editEmit:
		// The source's yield stays; yield x becomes yield* $yield(x), the
		// runtime's Yield operation, and yield* p yield* $yieldAll(p).
		switch e.arg {
		case "delegate":
			return pick(e.part, helperRef("$yieldAll")+"(", "", ")"), true
		case "undefined":
			return "* " + helperRef("$yield") + "(undefined)", true
		}
		return pick(e.part, "* "+helperRef("$yield")+"(", "", ")"), true
	case editEach:
		// for (const x of (yield* $each(xs))): a Stream's elements, or an
		// iterable as itself (execRendering.prologue).
		return pick(e.part, "(yield* "+helperRef("$each")+"(", "", "))"), true
	case editFail:
		if e.arg == "void" {
			return pick(e.part, "return (yield* "+helperRef("$fail")+"(", "", "))"), true
		}
		return pick(e.part, "return yield* "+helperRef("$fail")+"(", "", ")"), true
	case editServiceCall:
		// D41: a Context key's member call reads the service first.
		return pick(e.part, "(("+s+" = ", "", "), "+helperRef("$isKey")+"("+s+") ? (yield* "+s+") : "+s+")"), true
	case editPlainCall:
		return pick(e.part, helperRef("$plain")+"(", "", ")"), true
	case editBuiltinCall:
		return builtinCallText(e, false), true
	case editValueCall:
		// D90: a function is called; an Effect value, such as a key or a
		// Config, becomes a function whose result runs it.
		return renderValueCall(e), true
	case editUsing:
		// using x = acquire(): the acquisition runs in the Scope of the code
		// around it (execPrologue's $acquire).
		return pick(e.part, "(yield* "+helperRef("$acquire")+"("+helperRef("$scope")+", ", "", "))"), true
	case editServiceBase:
		// D45: the key; D40: a reference passes its default.
		base, key, name := e.fields[0], e.fields[1], e.fields[2]
		switch e.part {
		case partOpen:
			return serviceShapeBaseOpen(base, name), true
		case partClose:
			if base == "reference" {
				return ">(" + strconv.Quote(key) + ", () => " + name + ".default)", true
			}
			return ">(" + strconv.Quote(key) + ")", true
		}
		if base == "reference" {
			return helperRef("$reference") + "<" + name + ">(" + strconv.Quote(key) + ", () => " + name + ".default)", true
		}
		return helperRef("$service") + "<" + name + ">(" + strconv.Quote(key) + ")", true
	case editControl:
		// D2: a control registers its operations and their parameter counts.
		name := e.fields[0]
		var operations, arities []string
		for i := 1; i+1 < len(e.fields); i += 2 {
			operations = append(operations, strconv.Quote(e.fields[i]))
			arities = append(arities, e.fields[i+1])
		}
		return "\n" + helperRef("$control") + "(" + name + ", [" + strings.Join(operations, ", ") + "], [" + strings.Join(arities, ", ") + "]);", true
	case editScopeRegion:
		// A block's Scope region: $scopedBody is Effect.scoped (execHelpers).
		return e.text, true
	}
	panic("exec: kind " + e.kind.String() + " not implemented")
}

// dataMethodCandidateText supplies the name's generated module functions as
// direct imports, so an opaque receiver retains no unrelated method exports.
func dataMethodCandidateText(name string) string {
	var candidates []string
	for _, module := range dataMethodCandidates[name] {
		candidates = append(candidates, "["+strconv.Quote(module)+", "+helperRef("$method_"+module+"_"+name)+"]")
	}
	return "[" + strings.Join(candidates, ", ") + "]"
}

// generatorText opens the generator of an Effect body or program whose
// edit has arg: one that receives the function's this when arg says self.
func generatorText(arg string) string {
	if strings.Contains(arg, "self") {
		return helperRef("$gen") + "({ self: this }, function* () "
	}
	return helperRef("$gen") + "(function* () "
}

// execRendering renders a lowered plan: renderExec's text with each helper
// reference resolved to a local name that no identifier of the file spells,
// and the prefix that imports or defines each helper it used.
type execRendering struct {
	names *names
	// used holds the helpers the rendering resolved, by name.
	used map[string]bool
}

func newExecRendering(n *names) *execRendering {
	return &execRendering{names: n, used: map[string]bool{}}
}

func (r *execRendering) text(e edit) (string, bool) {
	text, keep := renderExec(e)
	if !keep {
		return "", false
	}
	return r.resolve(text), true
}

// resolve replaces each helper reference in text with the helper's local name.
func (r *execRendering) resolve(text string) string {
	var out strings.Builder
	for {
		start := strings.IndexByte(text, '\x01')
		if start < 0 {
			out.WriteString(text)
			return out.String()
		}
		end := strings.IndexByte(text[start:], '\x02')
		if end < 0 {
			out.WriteString(text)
			return out.String()
		}
		end += start
		out.WriteString(text[:start])
		out.WriteString(r.local(text[start+1 : end]))
		text = text[end+1:]
	}
}

// local returns the local name of helper and records its use. The identity
// helpers resolve to nothing, and helpers that are only types to their own
// names, which the transpiler erases with the annotation they stand in.
func (r *execRendering) local(helper string) string {
	switch {
	case identityHelpers[helper]:
		return ""
	case typeHelpers[helper]:
		return helper
	}
	r.used[helper] = true
	return r.names.helper(helper)
}

// identityHelpers are checking helpers that are the identity at run time:
// a region's boxed return value is the value (prelude.d.ts, $box).
var identityHelpers = map[string]bool{"$box": true, "$unboxed": true}

// typeHelpers are helper names that only appear in types.
var typeHelpers = map[string]bool{"$Infer": true, "$PreludeLoaded": true, "$Contract": true}

// execSource says where the executable rendering's import of a helper comes
// from: an export of a module, or, for prologue helpers and temporaries, the
// prefix itself.
type execSource struct {
	module string
	export string
}

// execHelpers are the helpers whose run-time source differs from their name
// or from the runtime. Every other helper that starts with $ is an export of
// vibelang-runtime under its own name.
var execHelpers = map[string]execSource{
	"$method": {"vibelang-runtime/data-methods", "$method"},

	"$gen":          {"effect/Effect", "gen"},
	"$fail":         {"effect/Effect", "fail"},
	"$plain":        {"vibelang-runtime", "$plainOf"},
	"$hatchTry":     {"vibelang-runtime", "try"},
	"$promise":      {"effect/Effect", "promise"},
	"$tryPromise":   {"effect/Effect", "tryPromise"},
	"$sync":         {"effect/Effect", "sync"},
	"$resume":       {"vibelang-runtime", "resume"},
	"$resumeWith":   {"vibelang-runtime", "resumeWith"},
	"$withSpan":     {"effect/Effect", "withSpan"},
	"$onExit":       {"effect/Effect", "onExit"},
	"$map":          {"effect/Effect", "map"},
	"$fnUntraced":   {"effect/Effect", "fnUntraced"},
	"$scopedBody":   {"effect/Effect", "scoped"},
	"$suspend":      {"effect/Effect", "suspend"},
	"$isStream":     {"effect/Stream", "isStream"},
	"$runCollect":   {"effect/Stream", "runCollect"},
	"$isKey":        {"effect/Context", "isKey"},
	"$isEffect":     {"effect/Effect", "isEffect"},
	"$succeed":      {"effect/Effect", "succeed"},
	"$ScopeKey":     {"effect/Scope", "Scope"},
	"$provideScope": {"effect/Scope", "provide"},
}

// prologueHelpers are defined by the prefix of each file that uses them
// (execRendering.prologue); temporaries are declared there too.
var prologueHelpers = map[string]bool{
	"$end": true, "$Jump": true, "$jump": true, "$returned": true, "$jumped": true, "$value": true, "$acquire": true,
	"$returnRun": true, "$member": true, "$dual": true, "$asProgram": true, "$programs": true, "$each": true,
	"$t": true, "$s": true, "$scope": true, "$iterate": true, "$producerGen": true, "$adapt": true,
}

// d151Names are the Effect functions a .vibe file calls without the
// Effect. prefix (prelude.d.ts), imported from effect/Effect.
var d151Names = setOf(`all die exit forEach log logDebug logError logInfo logWarning race repeat retry sleep timeout withSpan`)

// runtimePreludeNames are the runtime's prelude names (prelude.d.ts),
// imported from vibelang-runtime.
var runtimePreludeNames = setOf(`TaggedError Control pipe wire fork handle resume resumeWith abandon sync callback Resume runPromise
	runFork runSync runCallback detach forkIn interrupt yieldNow uninterruptible restore interruptible customMatcher`)

func setOf(list string) map[string]bool {
	set := map[string]bool{}
	for _, name := range strings.Fields(list) {
		set[name] = true
	}
	return set
}

// sourceOf returns the module and export the executable rendering imports
// name from, a prelude name or a helper.
func sourceOf(name string) execSource {
	if s, ok := execHelpers[name]; ok {
		return s
	}
	if strings.HasPrefix(name, "$method_") {
		module, method, _ := strings.Cut(strings.TrimPrefix(name, "$method_"), "_")
		return execSource{"effect/" + module, method}
	}
	switch {
	case runtimePreludeNames[name], strings.HasPrefix(name, "$"):
		return execSource{"vibelang-runtime", name}
	case d151Names[name]:
		return execSource{"effect/Effect", name}
	}
	return execSource{"effect", name}
}

// prefix returns the text before the file's first line: the imports of the
// prelude names and helpers the file uses, from effect and vibelang-runtime,
// then the temporaries and the prologue helpers. It runs after the edits
// are rendered, which records the helpers they use.
func (r *execRendering) prefix() string {
	candidates := r.candidateConstants()
	prologue := r.prologue()
	byModule := map[string][]string{}
	for export, local := range r.names.imports {
		name := strings.TrimPrefix(export, "\x00")
		if typeOnlyPrelude[name] || typeHelpers[name] || prologueHelpers[name] || identityHelpers[name] || strings.HasPrefix(name, "$methodCandidates_") {
			continue
		}
		if strings.HasPrefix(name, "$") && !r.used[name] {
			// A helper the checking rendering would use; this one does not.
			continue
		}
		source := sourceOf(name)
		specifier := source.export
		if local != source.export {
			specifier += " as " + local
		}
		byModule[source.module] = append(byModule[source.module], specifier)
	}
	modules := make([]string, 0, len(byModule))
	for module := range byModule {
		modules = append(modules, module)
	}
	slices.Sort(modules)
	var out strings.Builder
	for _, module := range modules {
		specifiers := byModule[module]
		slices.Sort(specifiers)
		out.WriteString("import { " + strings.Join(specifiers, ", ") + " } from " + strconv.Quote(module) + "; ")
	}
	out.WriteString(candidates)
	out.WriteString(prologue)
	if out.Len() > 0 {
		out.WriteString("\n")
	}
	return out.String()
}

// candidateConstants allocates one hygienic array per method name per file,
// before execution enters any function, and records its direct function imports.
func (r *execRendering) candidateConstants() string {
	var helpers []string
	for helper := range r.used {
		if strings.HasPrefix(helper, "$methodCandidates_") {
			helpers = append(helpers, helper)
		}
	}
	slices.Sort(helpers)
	var out strings.Builder
	for _, helper := range helpers {
		name := strings.TrimPrefix(helper, "$methodCandidates_")
		out.WriteString("const " + r.names.helper(helper) + " = " + r.resolve(dataMethodCandidateText(name)) + "; ")
	}
	return out.String()
}

// prologue returns the declarations of the temporaries and prologue helpers
// the rendering used. A region's completion is the returned value itself,
// the unique $end for a normal end, or a $Jump for a break or continue that
// leaves it; the dispatch after the region tests it with $returned and
// $jumped, as the checking rendering writes (regions.go). The definitions
// are a file's own, because a completion never leaves the function whose
// region made it.
func (r *execRendering) prologue() string {
	var returnRun string
	if r.used["$returnRun"] {
		returnRun = "const " + r.local("$returnRun") + " = (value: any): any => value; "
	}
	if r.used["$producerGen"] {
		for _, helper := range []string{"$gen", "$suspend", "$onExit"} {
			r.local(helper)
		}
	}
	if r.used["$iterate"] {
		for _, helper := range []string{"$end", "$jump", "$Jump", "$map", "$forOf"} {
			r.local(helper)
		}
	}
	if r.used["$member"] {
		r.local("$value")
	}
	var parts []string
	var temps []string
	for _, temp := range []string{"$t", "$s"} {
		if r.used[temp] {
			temps = append(temps, r.names.helper(temp))
		}
	}
	if len(temps) > 0 {
		// var, not let: a module-level let costs a TDZ check at every use.
		parts = append(parts, "var "+strings.Join(temps, ", ")+";")
	}
	needsJump := r.used["$jump"] || r.used["$returned"] || r.used["$jumped"]
	if r.used["$end"] || r.used["$returned"] {
		parts = append(parts, "const "+r.local("$end")+" = {};")
	}
	if needsJump {
		jump := r.local("$Jump")
		parts = append(parts, "class "+jump+" { constructor(k) { this.k = k } }")
		if r.used["$jump"] {
			parts = append(parts, "const "+r.local("$jump")+" = (k) => new "+jump+"(k);")
		}
		if r.used["$returned"] {
			parts = append(parts, "const "+r.local("$returned")+" = (c) => c !== "+r.local("$end")+" && !(c instanceof "+jump+");")
		}
		if r.used["$jumped"] {
			parts = append(parts, "const "+r.local("$jumped")+" = (c, k) => c instanceof "+jump+" && c.k === k;")
		}
	}
	if r.used["$value"] {
		// A Context key is a class, so a function that is a key runs too.
		parts = append(parts, "const "+r.local("$value")+" = (v) => typeof v === \"function\" && !"+r.local("$isKey")+"(v) ? v : () => "+r.local("$gen")+"(function* () { return yield* v });")
	}
	if r.used["$member"] {
		parts = append(parts, "const "+r.local("$member")+" = (self, key) => { const v = self[key]; return "+r.local("$value")+"(typeof v === \"function\" ? v.bind(self) : v); };")
	}
	if r.used["$acquire"] {
		// D14: the acquisition alone receives the region's Scope; the
		// region never installs it in the surrounding Context.
		parts = append(parts, "const "+r.local("$acquire")+" = (scope, v) => "+r.local("$using")+
			"(scope, "+r.local("$isEffect")+"(v) ? v : "+r.local("$succeed")+"(v));")
	}
	if r.used["$adapt"] {
		// D268: the runtime marker alone selects the call. A value without
		// one, a written plain function (D500) or an Effect function, is
		// called as it is; the runtime's $plainOf defects there instead (D495).
		direct := r.local("$direct")
		parts = append(parts, "const "+r.local("$adapt")+" = (f) => typeof f !== \"function\" ? f : (f["+direct+"] ?? function (...args) { const d = f["+direct+"]; "+
			"if (d !== undefined) return Reflect.apply(d, this, args); const result = Reflect.apply(f, this, args); const plain = result?.[Symbol.for(\"vibelang/plainForm\")]; return plain === undefined ? result : plain() });")
	}
	if r.used["$dual"] {
		// research/typedirected.md stock/perf/dual.mjs: the function takes the
		// program's prototype and own properties, so it is that Effect too.
		parts = append(parts, "const "+r.local("$dual")+" = (program) => { const f = () => program; Object.setPrototypeOf(f, Object.getPrototypeOf(program)); "+
			"for (const k of Reflect.ownKeys(program)) Object.defineProperty(f, k, Object.getOwnPropertyDescriptor(program, k)); return f };")
	}
	if r.used["$each"] {
		// The checking rendering iterates what $each gives, all of a
		// Stream's elements, so a Stream runs to its end before the loop's
		// first iteration; the plan has no loop region that would let a
		// producer and its loop take turns, as the fork's $forOf does.
		parts = append(parts, "const "+r.local("$each")+" = (v) => "+r.local("$isStream")+"(v) ? "+r.local("$runCollect")+"(v) : "+r.local("$succeed")+"(v);")
	}
	if r.used["$iterate"] {
		// The runtime uses tagged loop completions; the checking rendering
		// uses raw return values, the end sentinel, and Jump instances.
		end, jump, cls, mapping := r.local("$end"), r.local("$jump"), r.local("$Jump"), r.local("$map")
		parts = append(parts, "const "+r.local("$iterate")+" = (xs, body, label) => "+mapping+"("+r.local("$forOf")+"(xs, (v) => "+mapping+"(body(v), (c) => c === "+end+" ? { kind: \"normal\" } : c instanceof "+cls+" ? { kind: c.k.slice(0, c.k.indexOf(\":\")), label: c.k.slice(c.k.indexOf(\":\") + 1) } : { kind: \"return\", value: c }), label), (c) => c.kind === \"normal\" ? "+end+" : c.kind === \"return\" ? c.value : "+jump+"(c.kind + \":\" + c.label));")
	}

	if r.used["$producerGen"] {
		// Effect.gen does not close a native generator when an Effect fails
		// or a consumer abandons it. Drain return() under onExit so native
		// finally blocks can themselves yield their cleanup Effects.
		gen := r.local("$gen")
		parts = append(parts, "const "+r.local("$producerGen")+" = (options, body) => "+r.local("$suspend")+"(() => { const it = body ? body.call(options.self) : options(); return "+r.local("$onExit")+"("+gen+"(() => it), () => "+gen+"(function* () { let s = it.return(undefined); while (!s.done) { const v = yield s.value; s = it.next(v) } })); });")
	}

	if r.used["$asProgram"] || r.used["$programs"] {
		parts = append(parts, "const "+r.local("$asProgram")+" = (v) => typeof v === \"function\" && !"+r.local("$isEffect")+"(v) && !"+r.local("$isKey")+"(v) ? "+r.local("$suspend")+"(() => { const result = v(); return "+r.local("$isRun")+"(result) ? result : "+r.local("$succeed")+"(result); }) : v;")
	}
	if r.used["$programs"] {
		parts = append(parts, "const "+r.local("$programs")+" = (xs) => Symbol.iterator in xs ? Array.from(xs, "+r.local("$asProgram")+") : Object.fromEntries(Object.entries(xs).map(([k, v]) => [k, "+r.local("$asProgram")+"(v)]));")
	}
	return returnRun + strings.Join(parts, " ")
}

// ---------------------------------------------------------------- lowering

// span is the edits of one paired kind, by index in the plan: its open,
// middle (-1 when the kind has none), and close edit.
type span struct {
	open, middle, close int
}

// execFunction is a top-level function declaration that the executable
// rendering splits.
type execFunction struct {
	node *ast.Node
	name string
	// pure: the body is provably pure from syntax, so f compiles to
	// f$direct and a wrapper (D10); otherwise to f$body, f, and f$fast.
	pure   bool
	cyclic bool
	// direct is f$direct or f$fast, the name a same-file call uses; body is
	// the generator's name, f$body.
	direct, body string
	// effectBody or contract is the function's own Effect body edits.
	effectBody, contract *span
}

// execLowering rewrites a projector's plan for the executable rendering.
type execLowering struct {
	p     *projector
	edits []edit
	// spans pairs each run, effect body, contract, program, fail, service
	// call, and value call with its other parts.
	spans map[editKind][]span
	// calls are the file's call expressions by [token start, end), and
	// receivers the identifiers that are the object of a member access.
	calls     map[[2]int]*ast.Node
	receivers map[[2]int]*ast.Node
	// valueCalls holds the callee positions of D90 value calls.
	valueCalls map[int]bool
	functions  map[string]*execFunction
	// scoped holds the open edit of each Effect body or program with a
	// using declaration or a block fork of its own (scopeBodies).
	scoped map[int]bool
	args   string
}

// execPlan returns p's plan lowered for the executable rendering.
func (p *projector) execPlan() *plan {
	l := &execLowering{
		p:          p,
		edits:      p.directBuiltinEdits(),
		calls:      map[[2]int]*ast.Node{},
		receivers:  map[[2]int]*ast.Node{},
		valueCalls: map[int]bool{},
		functions:  map[string]*execFunction{},
	}
	l.pair()
	l.collect(p.file.AsNode())
	for _, s := range l.spans[editValueCall] {
		l.valueCalls[l.edits[s.open].pos] = true
	}
	l.args = p.freshWord("$args")
	l.scopeBodies()
	l.splitFunctions()
	l.traceBodies()
	l.lowerCalls()
	l.lowerServiceCalls()
	l.lowerClauses()
	l.lowerCallClauseResumes()
	l.lowerResumeValues()
	l.lowerImports()
	l.entry()
	l.lowerLoops()
	return &plan{edits: l.edits}
}

// pair matches the parts of each paired kind. The walk records an open
// edit, then the edits of what it encloses, then the close, so in record
// order a close belongs to the latest open of its kind still unclosed.
func (l *execLowering) pair() {
	l.spans = map[editKind][]span{}
	stacks := map[editKind][]span{}
	for i, e := range l.edits {
		switch e.kind {
		// editEmit is left out: a bare yield is one edit with no close.
		case editRun, editEffectBody, editContract, editProgram, editFail, editServiceCall, editValueCall, editUsing, editDual, editScoped,
			editProgramValue, editProducer, editEach:
		default:
			continue
		}
		stack := stacks[e.kind]
		switch e.part {
		case partOpen:
			stacks[e.kind] = append(stack, span{open: i, middle: -1, close: -1})
		case partMiddle:
			if len(stack) > 0 {
				stack[len(stack)-1].middle = i
			}
		case partClose:
			if len(stack) == 0 {
				continue
			}
			s := stack[len(stack)-1]
			s.close = i
			stacks[e.kind] = stack[:len(stack)-1]
			l.spans[e.kind] = append(l.spans[e.kind], s)
		}
	}
}

// collect indexes the call expressions and member-access receivers under
// node by their spans, which is how the plan's edits locate them.
func (l *execLowering) collect(node *ast.Node) {
	node.ForEachChild(func(child *ast.Node) bool {
		switch child.Kind {
		case ast.KindCallExpression:
			l.calls[[2]int{l.p.tokenStart(child), child.End()}] = child
		case ast.KindPropertyAccessExpression:
			if receiver := child.Expression(); receiver != nil {
				l.receivers[[2]int{l.p.tokenStart(receiver), receiver.End()}] = receiver
			}
		}
		l.collect(child)
		return false
	})
}

// set replaces edit i with syntax text, keeping its position.
func (l *execLowering) set(i int, text string) {
	e := l.edits[i]
	l.edits[i] = edit{pos: e.pos, end: e.end, text: text}
}

// insert adds syntax text before the original character at pos. Among
// edits at one position it renders after those the walk recorded.
func (l *execLowering) insert(pos int, text string) {
	l.edits = append(l.edits, edit{pos: pos, end: pos, text: text})
}

// replace adds syntax text in place of the original text in [pos, end).
func (l *execLowering) replace(pos int, end int, text string) {
	l.edits = append(l.edits, edit{pos: pos, end: end, text: text})
}

// splitFunctions decides how each top-level Effect function compiles and
// rewrites its declaration. A function is a candidate when it has a body,
// is projected as an Effect function (no plain return annotation), and is
// the file's only declaration of its name, so no overload, parameter, or
// inner declaration shadows it at a call. The projector's purity result
// decides which candidates get a direct entry (D10, D56).
func (l *execLowering) splitFunctions() {
	bodies := map[int]*span{}
	for i := range l.spans[editEffectBody] {
		s := &l.spans[editEffectBody][i]
		bodies[l.edits[s.open].pos] = s
	}
	contracts := map[int]*span{}
	for i := range l.spans[editContract] {
		s := &l.spans[editContract][i]
		contracts[l.edits[s.close].pos] = s
	}
	declarations := l.p.purityDeclarations()
	var order []*execFunction
	for _, statement := range l.p.file.Statements.Nodes {
		if !isProjectedFunction(statement) || statement.Name() == nil {
			continue
		}
		name := statement.Name().Text()
		if l.traceName(statement) != "" && l.p.plainBuiltinBodies[statement] == nil {
			continue
		}
		if declarations[name] != 1 || ast.HasSyntacticModifier(statement, ast.ModifierFlagsAmbient) {
			continue
		}
		body := statement.Body()
		f := &execFunction{node: statement, name: name}
		if s := bodies[l.p.tokenStart(body)+1]; s != nil {
			f.effectBody = s
		} else if s := contracts[body.End()]; s != nil {
			f.contract = s
		} else {
			continue // a plain function (L2), or one the walk did not lower
		}
		if f.effectBody != nil && l.scoped[f.effectBody.open] || f.contract != nil && l.scoped[f.contract.open] {
			continue // its body is scoped, so it runs only as an Effect (scopeBodies)
		}
		l.functions[name] = f
		order = append(order, f)
	}
	pure := map[string]bool{}
	for _, f := range l.p.purity() {
		pure[f.Name] = f.ProvablyPure
	}
	for _, f := range order {
		f.pure = pure[f.name]
	}
	l.markFastCycles()
	for _, f := range order {
		l.splitFunction(f)
	}
}

// scopeBodies gives only a block's own using declarations and forks its
// private Scope (D14, D19). Nested scope regions already belong to the
// plan; wrapping their enclosing function would capture ordinary scoped
// acquisitions and end their lifetimes early. Statement regions keep a
// braced statement and a separator before else, including when they have a
// completion to dispatch.
func (l *execLowering) scopeBodies() {
	l.scoped = map[int]bool{}
	scope := helperRef("$scope")
	regionOpen := helperRef("$region") + "((" + scope + ") => "
	var blocks = map[int]*ast.Node{}
	var visit func(*ast.Node)
	visit = func(n *ast.Node) {
		// A do block's function and a match expression's run in the region
		// around them, which owns their forks (D408).
		if ast.IsFunctionLike(n) && n.Body() != nil && n.Body().Kind == ast.KindBlock && !isRegionTransparent(n) {
			body := n.Body()
			blocks[l.p.tokenStart(n)] = body
			blocks[l.p.tokenStart(body)] = body
			blocks[l.p.tokenStart(body)+1] = body
			blocks[body.End()] = body
		}
		// An arrow's expression body owns its forks too (D353).
		if n.Kind == ast.KindArrowFunction && n.Body() != nil && n.Body().Kind != ast.KindBlock && !isRegionTransparent(n) {
			body := n.Body()
			for _, at := range []int{l.p.tokenStart(n), l.p.tokenStart(body)} {
				if blocks[at] == nil {
					blocks[at] = body
				}
			}
		}
		n.ForEachChild(func(c *ast.Node) bool { visit(c); return false })
	}
	visit(l.p.file.AsNode())
	var bodies []span
	bodies = append(bodies, l.spans[editEffectBody]...)
	bodies = append(bodies, l.spans[editProgram]...)
	bodies = append(bodies, l.spans[editProducer]...)
	bodies = append(bodies, l.spans[editContract]...)
	for _, b := range bodies {
		body := blocks[l.edits[b.open].pos]
		if l.edits[b.open].kind == editContract {
			body = blocks[l.edits[b.close].pos]
		}
		if body == nil || body.Kind == ast.KindBlock && !l.p.holdsScope(body.Statements()) || body.Kind != ast.KindBlock && !l.p.holdsScopeIn(body) {
			continue
		}
		opening := b.open
		if b.middle >= 0 {
			opening = b.middle
		}
		contract := l.edits[b.open].kind == editContract
		open, _ := renderExec(l.edits[opening])
		close, _ := renderExec(l.edits[b.close])
		gen := strings.Index(open, helperRef("$gen"))
		if gen < 0 {
			gen = strings.Index(open, helperRef("$producerGen"))
		}
		if gen < 0 {
			continue
		}
		l.scoped[b.open] = true
		l.set(opening, open[:gen]+regionOpen+open[gen:])
		if contract {
			close = strings.TrimSuffix(close, "}") + ")}"
		} else {
			close += ")"
		}
		l.set(b.close, close)
	}
	for i, e := range l.edits {
		if e.kind != editRegion && e.kind != editScopeRegion {
			continue
		}
		text := strings.ReplaceAll(e.text, helperRef("$scopedBody")+"(", regionOpen)
		if e.kind == editScopeRegion && e.part == partOpen {
			text = "{ " + text
		}
		l.edits[i].text = text
		if e.kind == editScopeRegion && e.part == partClose {
			for j := i + 1; j < len(l.edits); j++ {
				if d := l.edits[j]; d.pos == e.pos && d.kind == editDispatch {
					l.edits[j].text += "; }"
					break
				}
			}
		}
	}
}

// markFastCycles counts only cycles of calls lowered to same-file fast entries.
// Calls inside lambdas start on the fiber and cannot extend eager nesting.
func (l *execLowering) markFastCycles() {
	edges := map[*execFunction][]*execFunction{}
	for _, s := range l.spans[editRun] {
		if l.edits[s.open].arg == "return" {
			continue
		}
		call := l.calls[[2]int{l.edits[s.open].pos, l.edits[s.close].pos}]
		if call == nil {
			continue
		}
		callee := call.Expression()
		if callee.Kind != ast.KindIdentifier || call.QuestionDotToken() != nil || callee.Flags&ast.NodeFlagsReparsed != 0 {
			continue
		}
		target := l.functions[callee.Text()]
		if target == nil || target.pure {
			continue
		}
		for owner := call.Parent; owner != nil; owner = owner.Parent {
			if ast.IsFunctionLike(owner) {
				if owner.Name() != nil {
					if from := l.functions[owner.Name().Text()]; from != nil && from.node == owner && !from.pure {
						edges[from] = append(edges[from], target)
					}
				}
				break
			}
		}
	}
	for _, start := range l.functions {
		seen := map[*execFunction]bool{}
		var reaches func(*execFunction) bool
		reaches = func(f *execFunction) bool {
			for _, next := range edges[f] {
				if next == start {
					return true
				}
				if !seen[next] {
					seen[next] = true
					if reaches(next) {
						return true
					}
				}
			}
			return false
		}
		start.cyclic = reaches(start)
	}
}

// readsArguments reports whether fn's own body refers to arguments, outside
// nested functions other than arrows, which share their enclosing arguments.
func readsArguments(fn *ast.Node) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindIdentifier && node.Text() == "arguments" {
			return true
		}
		if ast.IsFunctionLike(node) && node.Kind != ast.KindArrowFunction {
			return false
		}
		return node.ForEachChild(visit)
	}
	body := fn.Body()
	return body != nil && body.ForEachChild(visit)
}

// fastParameters forwards each argument once to the body, where defaults and
// destructuring bind and may throw. Rest arguments spread into that same list.
func (l *execLowering) fastParameters(f *execFunction) (string, string) {
	var parameters, arguments []string
	for i, parameter := range f.node.Parameters() {
		name := parameter.Name()
		if name.Kind == ast.KindIdentifier && name.Text() == "this" {
			continue
		}
		var word string
		if name.Kind == ast.KindIdentifier {
			word = name.Text()
		} else {
			word = l.p.freshWord("$arg" + strconv.Itoa(i))
		}
		if parameter.AsParameterDeclaration().DotDotDotToken != nil {
			word = "..." + word
		}
		parameters = append(parameters, word)
		arguments = append(arguments, word)
	}
	return strings.Join(parameters, ", "), strings.Join(arguments, ", ")
}

// splitFunction rewrites f's declaration. A pure function:
//
//	export function add(a, b) { return a + b }
//	export function add(...$args) { return $plainSync(add$direct, this, $args) } add[$direct] = add$direct;
//	function add$direct(a, b) { return a + b }
//
// Any other:
//
//	export function f(id) { body }
//	export function f(...$args) { return (f$effect ??= $fnUntraced(f$body)).apply(this, $args) } var f$effect; const f$fast = $fast(f$body);
//	function* f$body(id) { body }
//
// The wrapper is a function declaration, hoisted as the checking
// rendering's function is. Acyclic fast entries are hoisted too; cycles use
// the runtime's counted $fast entry to bound eager recursion.
// The modifiers move to the wrapper, so f$direct and f$body are module
// locals and an export default stays the wrapper.
func (l *execLowering) splitFunction(f *execFunction) {
	node := f.node
	start := l.p.tokenStart(node)
	keyword := start
	var modifiers []string
	if list := node.Modifiers(); list != nil {
		for _, modifier := range list.Nodes {
			modifiers = append(modifiers, scanner.TokenToString(modifier.Kind))
			keyword = scanner.SkipTrivia(l.p.text, modifier.End())
		}
	}
	if !strings.HasPrefix(l.p.text[keyword:], "function") {
		return
	}
	head := strings.Join(append(modifiers, "function "+f.name), " ")
	args := l.args
	var wrapper string
	if f.pure {
		f.direct = l.p.freshWord(f.name + "$direct")
		wrapper = head + "(..." + args + ") { return " + helperRef("$plainSync") + "(" + f.direct + ", this, " + args + ") } " +
			f.name + "[" + helperRef("$direct") + "] = " + f.direct + ";\n"
		l.insert(node.Name().End(), strings.TrimPrefix(f.direct, f.name))
	} else {
		f.direct = l.p.freshWord(f.name + "$fast")
		f.body = l.p.freshWord(f.name + "$body")
		effect := l.p.freshWord(f.name + "$effect")
		wrapper = head + "(..." + args + ") { return (" + effect + " ??= " + helperRef("$fnUntraced") + "(" + f.body + ")).apply(this, " + args + ") } " +
			"var " + effect + "; "
		// A body that reads arguments needs every argument, which only the
		// counted entry forwards; the acyclic entry names the parameters.
		if f.cyclic || readsArguments(node) {
			wrapper += "const " + f.direct + " = " + helperRef("$fast") + "(" + f.body + ");\n"
		} else {
			parameters, arguments := l.fastParameters(f)
			it, step := l.p.freshWord("it"), l.p.freshWord("s")
			wrapper += "function " + f.direct + "(" + parameters + ") { const " + it + " = " + f.body + "(" + arguments + "), " + step + " = " + it + ".next(); return " + step + ".done ? " + helperRef("$done") + "(" + step + ".value) : " + helperRef("$settle") + "(" + it + ", " + step + ") }\n"
		}
		l.insert(keyword+len("function"), "*")
		l.insert(node.Name().End(), strings.TrimPrefix(f.body, f.name))
	}
	l.replace(start, keyword, wrapper)
	// The body is the split function's own, not a generator's.
	if s := f.effectBody; s != nil {
		l.set(s.open, "")
		l.set(s.close, "")
	}
	if s := f.contract; s != nil {
		l.set(s.open, ": $Contract<")
		l.set(s.middle, "> ")
		l.set(s.close, "")
	}
}

// lowerCalls rewrites the calls that run by their callee:
//
//	pure global           Math.max(a, b)
//	same-file pure f      f$direct(x)
//	same-file other f     (($t = f$fast(x)), $isRun($t) ? (yield* $t) : $t)
//	imported f            (($t = (f[$direct] ?? f)(x)), f[$direct] ? $t : ($isRun($t) ? (yield* $t) : $t))
//	any other             renderExec's run check
//
// An imported callee is a name a relative import declares, read through
// its $direct property at the call, so no type of the other file is
// needed; the property is looked up again after the call, because the
// arguments may pause and run other calls in between. A value call (D90)
// keeps its own lowering.
func (l *execLowering) lowerCalls() {
	for _, s := range l.spans[editRun] {
		if l.edits[s.open].arg == "return" {
			continue
		}
		call := l.calls[[2]int{l.edits[s.open].pos, l.edits[s.close].pos}]
		if call == nil {
			continue
		}
		if l.p.isPureGlobal(call) && l.p.builtinFailure(call) == "" {
			l.set(s.open, "")
			l.set(s.close, "")
			continue
		}
		callee := call.Expression()
		// An intrinsic, such as the keyword fork's callee, is the prelude's
		// export, never a function of the file (rule H5).
		if callee.Kind != ast.KindIdentifier || call.QuestionDotToken() != nil || callee.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) != 0 {
			continue
		}
		name := callee.Text()
		if f := l.functions[name]; f != nil {
			if f.pure {
				l.set(s.open, "")
				l.set(s.close, "")
			}
			l.insert(callee.End(), strings.TrimPrefix(f.direct, name))
			continue
		}
		if from, ok := l.p.names.importedFrom[name]; ok && strings.HasPrefix(from, ".") && l.p.names.declarations[name] == 1 && !l.valueCalls[l.p.tokenStart(callee)] {
			t, direct := helperRef("$t"), helperRef("$direct")
			l.set(s.open, "(("+t+" = (")
			l.insert(callee.End(), "["+direct+"] ?? "+name+")")
			l.set(s.close, "), "+name+"["+direct+"] ? "+t+" : ("+helperRef("$isRun")+"("+t+") ? (yield* "+t+") : "+t+"))")
		}
	}
}

// keyMembers are the members a Context key owns itself (L8): a member call
// of one of these on a key calls the key's own member, unless a service the
// file declares declares it.
var keyMembers = setOf(`pipe of use key name length call apply bind toString`)

// lowerServiceCalls rewrites each member call on a possible service key
// (D41) with the member's name: a key's own members, static ones included,
// win where the service the file declares does not declare the member, as
// $use's type says, so the run-time test reads the service only when the
// key has no member of that name:
//
//	(($s = Users), $isKey($s) && !("find" in $s) ? (yield* $s) : $s).find(id)
func (l *execLowering) lowerServiceCalls() {
	for _, s := range l.spans[editServiceCall] {
		open, close := l.edits[s.open], l.edits[s.close]
		receiver := l.receivers[[2]int{open.pos, close.pos}]
		if receiver == nil {
			continue
		}
		member := receiver.Parent.Name().Text()
		declared := false
		var service *ast.Node
		if ast.IsIdentifier(receiver) {
			service = l.p.services[receiver.Text()]
		}
		if service != nil {
			for _, m := range service.Members() {
				if m.Name() != nil && m.Name().Text() == member && !ast.IsStatic(m) {
					declared = true
				}
			}
		}
		if !declared && keyMembers[member] {
			l.set(s.open, "")
			l.set(s.close, "")
			continue
		}
		t := helperRef("$s")
		test := helperRef("$isKey") + "(" + t + ")"
		if !declared {
			test += " && !(" + strconv.Quote(member) + " in " + t + ")"
		}
		l.set(s.close, "), "+test+" ? (yield* "+t+") : "+t+")")
	}
}

// lowerImports rewrites a relative import or export of a .vibe module to
// the JavaScript the module compiles to, ./users.vibe to ./users.js, as
// the fork's emit does.
func (l *execLowering) lowerImports() {
	for _, statement := range l.p.file.Statements.Nodes {
		var specifier *ast.Node
		switch statement.Kind {
		case ast.KindImportDeclaration:
			specifier = statement.AsImportDeclaration().ModuleSpecifier
		case ast.KindExportDeclaration:
			specifier = statement.AsExportDeclaration().ModuleSpecifier
		}
		if specifier == nil || !ast.IsStringLiteral(specifier) {
			continue
		}
		module := specifier.Text()
		if !strings.HasPrefix(module, ".") || !strings.HasSuffix(module, ".vibe") {
			continue
		}
		start := l.p.tokenStart(specifier)
		quote := l.p.text[start : start+1]
		l.replace(start, specifier.End(), quote+strings.TrimSuffix(module, ".vibe")+".js"+quote)
	}
}

// entry appends the entry statement of a module that exports a function
// named main with no parameters and calls no runner at its top level
// (D135): $entry(import.meta.main, import.meta.url, main, () =>
// $runMain(main())), as the fork writes it (entry.go). A main with a plain
// return annotation runs through Effect.sync. The fork runs with
// @effect/platform-node's NodeRuntime when that package resolves; a
// projection cannot resolve packages, so this one always uses the
// runtime's copy of the runner.
func (l *execLowering) entry() {
	var main *ast.Node
	for _, statement := range l.p.file.Statements.Nodes {
		switch {
		case statement.Kind == ast.KindFunctionDeclaration && statement.Name() != nil && statement.Name().Text() == "main" &&
			ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) && !ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) &&
			len(statement.Parameters()) == 0 && statement.Body() != nil:
			main = statement
		case statement.Kind == ast.KindExpressionStatement && callsRunnerSyntax(statement.Expression()):
			return
		}
	}
	if main == nil || !isProjectedFunction(main) {
		return
	}
	program := "main()"
	if contractOf(main.Type()) == contractPlain {
		program = helperRef("$sync") + "(main)"
	}
	l.insert(len(l.p.text), "\n"+helperRef("$entry")+"(import.meta.main, import.meta.url, main, () => "+helperRef("$runMain")+"("+program+"));\n")
}

// callsRunnerSyntax reports whether expression calls a runner, such as
// NodeRuntime.runMain(…) or runPromise(…), as the fork's callsRunner does.
func callsRunnerSyntax(expression *ast.Node) bool {
	expression = ast.SkipParentheses(expression)
	if !ast.IsCallExpression(expression) {
		return false
	}
	runners := setOf(`runMain runPromise runFork runSync runCallback`)
	switch callee := expression.Expression(); {
	case ast.IsIdentifier(callee):
		return runners[callee.Text()]
	case ast.IsPropertyAccessExpression(callee):
		return runners[callee.Name().Text()]
	}
	return false
}

// lowerLoops renders the plan's each operations as internal iteration
// (D26). A callback returns the same completions as a checking region;
// $iterate adapts those to the runtime's for-of protocol. This preserves
// early exit, producer cleanup, and one element per pull instead of first
// collecting the entire Stream. Ordinary iterable loops use the same
// protocol, since syntax cannot tell which value a call returns.
func (l *execLowering) lowerLoops() {
	each := map[[2]int]span{}
	for _, s := range l.spans[editEach] {
		each[[2]int{l.edits[s.open].pos, l.edits[s.close].pos}] = s
	}
	rewritten := map[*ast.Node]bool{}
	var visit func(*ast.Node)
	visit = func(n *ast.Node) {
		n.ForEachChild(func(c *ast.Node) bool { visit(c); return false })
		if n.Kind != ast.KindForOfStatement {
			return
		}
		loop := n.AsForInOrOfStatement()
		if init := loop.Initializer; init.Kind == ast.KindVariableDeclarationList && len(init.AsVariableDeclarationList().Declarations.Nodes) == 0 {
			// A partially written loop can have a declaration list with no
			// binding. Leave it for diagnostics instead of indexing a name.
			l.p.unprojected(n)
			return
		}
		s, ok := each[[2]int{l.p.tokenStart(loop.Expression), loop.Expression.End()}]
		if !ok {
			return
		}
		l.set(s.open, "")
		l.set(s.close, "")
		start := l.p.tokenStart(n)
		label := ""
		if n.Parent.Kind == ast.KindLabeledStatement {
			label = n.Parent.AsLabeledStatement().Label.Text()
			start = l.p.tokenStart(n.Parent)
		}
		value := l.p.freshWord("$item")
		completion := l.p.freshCompletion()
		init := loop.Initializer
		binding := l.p.text[l.p.tokenStart(init):init.End()] + " = " + value + "; "
		using := init.Kind == ast.KindVariableDeclarationList && init.Flags&ast.NodeFlagsUsing != 0
		hoist := ""
		if init.Kind == ast.KindVariableDeclarationList {
			list := init.AsVariableDeclarationList()
			name := list.Declarations.Nodes[0].Name()
			if using {
				binding = "const " + l.p.text[l.p.tokenStart(name):name.End()] + " = (yield* " + helperRef("$acquire") + "(" + helperRef("$scope") + ", " + value + ")); "
			} else if init.Flags&ast.NodeFlagsBlockScoped == 0 {
				hoist = "var " + l.p.text[l.p.tokenStart(name):name.End()] + "; "
				binding = l.p.text[l.p.tokenStart(name):name.End()] + " = " + value + "; "
			}
		}
		opening := "{ " + hoist + "const " + completion + " = yield* " + helperRef("$iterate") + "("
		l.replace(start, l.p.tokenStart(loop.Expression), opening)
		callback := ", (" + value + ") => "
		if using {
			callback += helperRef("$region") + "((" + helperRef("$scope") + ") => "
		}
		callback += helperRef("$gen") + "(" + selfPrefix(loop.Statement) + "function* () { " + binding
		l.replace(loop.Expression.End(), l.p.tokenStart(loop.Statement), callback)
		closing := "; return " + helperRef("$end") + "; })"
		if using {
			closing += ")"
		}
		closing += ", " + strconv.Quote(label) + "); if (" + helperRef("$returned") + "(" + completion + ")) return " + completion + "; "
		escapes := []jump{}
		var jumps func(*ast.Node)
		jumps = func(c *ast.Node) {
			if ast.IsFunctionLike(c) || ast.IsClassLike(c) {
				return
			}
			if c.Kind == ast.KindBreakStatement || c.Kind == ast.KindContinueStatement {
				target := execJumpTarget(c)
				if target != nil && (target == n || target.Pos() < n.Pos() || target.End() > n.End()) {
					j := jump{kind: c.Kind}
					if c.Label() != nil {
						j.label = c.Label().Text()
					}
					if target != n && !slices.Contains(escapes, j) {
						escapes = append(escapes, j)
					}
					// Existing checking regions dispatch in the original loop's
					// frame. That frame is now this callback, so their jumps
					// crossing it must return the completion too.
					action := strings.TrimSpace(execJumpWord(j.kind) + " " + j.label)
					for i, e := range l.edits {
						if e.kind == editDispatch && e.pos >= l.p.tokenStart(loop.Statement) && e.pos <= loop.Statement.End() {
							for _, prefix := range []string{"; ", ") "} {
								from := prefix + action
								to := prefix + "return " + helperRef("$jump") + "(" + strconv.Quote(jumpKind(j)) + ")"
								if strings.HasSuffix(e.text, from) {
									e.text = strings.TrimSuffix(e.text, from) + to
								}
								e.text = strings.ReplaceAll(e.text, from+";", to+";")
							}
							l.edits[i].text = e.text
						}
					}
					if !rewritten[c] {
						// A checking region may already have recorded this jump.
						recorded := false
						for _, e := range l.edits {
							if e.pos == l.p.tokenStart(c) && e.end == c.End() {
								recorded = true
								break
							}
						}
						if !recorded {
							l.replace(l.p.tokenStart(c), c.End(), "return "+helperRef("$jump")+"("+strconv.Quote(jumpKind(j))+");")
						}
						rewritten[c] = true
					}
				}
			}
			c.ForEachChild(func(child *ast.Node) bool { jumps(child); return false })
		}
		jumps(loop.Statement)
		for _, j := range escapes {
			action := strings.TrimSpace(execJumpWord(j.kind) + " " + j.label)
			target := execLabeledTarget(n, j.label)
			if target != nil && target.Kind == ast.KindForOfStatement {
				action = "return " + helperRef("$jump") + "(" + strconv.Quote(jumpKind(j)) + ")"
			}
			for parent := n.Parent; parent != nil && parent != target; parent = parent.Parent {
				if parent.Kind == ast.KindForOfStatement || parent.Kind == ast.KindTryStatement ||
					parent.Kind == ast.KindBlock && parent.Parent != nil && !ast.IsFunctionLike(parent.Parent) && ownsForks(parent) && l.p.holdsScope(parent.Statements()) ||
					l.p.isLoopStatementRegion(parent) {
					action = "return " + helperRef("$jump") + "(" + strconv.Quote(jumpKind(j)) + ")"
					break
				}
			}
			closing += "if (" + helperRef("$jumped") + "(" + completion + ", " + strconv.Quote(jumpKind(j)) + ")) " + action + "; "
		}
		l.insert(n.End(), closing+"}")
	}
	visit(l.p.file.AsNode())
}

// execJumpTarget finds a source jump's target before loop callbacks add
// function boundaries, so only jumps that leave a callback become records.
func execJumpTarget(n *ast.Node) *ast.Node {
	if label := n.Label(); label != nil {
		return execLabeledTarget(n, label.Text())
	}
	for p := n.Parent; p != nil && !ast.IsFunctionLike(p); p = p.Parent {
		if ast.IsIterationStatement(p, false) || n.Kind == ast.KindBreakStatement && p.Kind == ast.KindSwitchStatement {
			return p
		}
	}
	return nil
}

// execLabeledTarget resolves a written label lexically; a loop's label
// names the iteration itself so the runtime can consume its own jumps.
func execLabeledTarget(n *ast.Node, label string) *ast.Node {
	for p := n.Parent; p != nil && !ast.IsFunctionLike(p); p = p.Parent {
		if p.Kind == ast.KindLabeledStatement && p.AsLabeledStatement().Label.Text() == label {
			return p.AsLabeledStatement().Statement
		}
	}
	return nil
}

// execJumpWord spells a jump action; statement kinds are not token kinds
// and therefore cannot be printed with scanner.TokenToString.
func execJumpWord(kind ast.Kind) string {
	if kind == ast.KindBreakStatement {
		return "break"
	}
	return "continue"
}

// lowerClauses takes the continuation from the last argument the runtime
// supplies (D132), independently of how many operation arguments a clause
// binds. A non-tail resume carries the resumed completion through normal
// clause fallthrough (D97). In a cleanup region even a syntactic tail
// resume must run before cleanup, rather than returning a tail request.
func (l *execLowering) lowerClauses() {
	k, args, pending := l.p.freshWord("$k"), l.p.freshWord("$clauseArgs"), l.p.freshWord("$pending")
	var visit func(*ast.Node)
	visit = func(n *ast.Node) {
		if n.Kind == ast.KindTryStatement && n.Flags&ast.NodeFlagsVibeLang != 0 {
			groups, ok := handleClauses(n)
			if ok {
				for _, group := range groups {
					for _, clause := range group.clauses {
						brace := l.p.clauseBodyBrace(clause)
						if brace < 0 {
							continue
						}
						for i, e := range l.edits {
							if e.kind == editRegion && e.end == brace {
								text := strings.ReplaceAll(e.text, ", "+k+") =>", ", ..."+args+") =>")
								text = strings.ReplaceAll(text, "("+k+") =>", "(..."+args+") =>")
								l.edits[i].text = text
							}
						}
						l.insert(brace+1, " const "+k+" = "+args+"["+args+".length - 1]; ")
						needsPending := false
						var resumes func(*ast.Node)
						resumes = func(c *ast.Node) {
							if ast.IsFunctionLike(c) || ast.IsClassLike(c) {
								return
							}
							if ast.IsCallExpression(c) && ast.IsIdentifier(c.Expression()) &&
								(c.Expression().Text() == "resume" || c.Expression().Text() == "resumeWith") &&
								len(c.Arguments()) > 0 && isContinuationArgument(c.Arguments()[0]) {
								tail := c.Parent != nil && isTailResume(c.Parent)
								cleanup := l.p.holdsScope(clause.body)
								for p := c.Parent; p != nil && p != clause.block; p = p.Parent {
									if p.Kind == ast.KindTryStatement || p.Kind == ast.KindBlock && ownsForks(p) && l.p.holdsScope(p.Statements()) || l.p.isLoopStatementRegion(p) {
										cleanup = true
									}
								}
								if tail && !cleanup {
									return
								}
								needsPending = true
								if tail {
									helper := "$resume"
									if c.Expression().Text() == "resumeWith" {
										helper = "$resumeWith"
									}
									for i, e := range l.edits {
										if e.pos == l.p.tokenStart(c.Expression()) && e.end == c.Expression().End() {
											l.set(i, "("+pending+" = (yield* "+helperRef(helper))
											break
										}
									}
									l.insert(c.End(), "))")
								} else {
									for _, s := range l.spans[editRun] {
										if l.edits[s.open].pos == l.p.tokenStart(c) && l.edits[s.close].pos == c.End() {
											open, _ := renderExec(l.edits[s.open])
											close, _ := renderExec(l.edits[s.close])
											l.set(s.open, "("+pending+" = "+open)
											l.set(s.close, close+")")
											break
										}
									}
								}
								return
							}
							c.ForEachChild(func(child *ast.Node) bool { resumes(child); return false })
						}
						for _, statement := range clause.body {
							resumes(statement)
						}
						if needsPending {
							l.insert(brace+1, " let "+pending+" = "+helperRef("$end")+"; ")
							end := clause.block.End() - 1
							for i, e := range l.edits {
								if e.pos == end && e.kind == editRecord && strings.Contains(e.text, "return "+helperRef("$end")) {
									l.edits[i].text = strings.ReplaceAll(e.text, "return "+helperRef("$end"), "return "+pending)
								}
							}
							l.insert(end, "; return "+pending+"; ")
						}
					}
				}
			}
		}
		n.ForEachChild(func(c *ast.Node) bool { visit(c); return false })
	}
	visit(l.p.file.AsNode())
}

// traceName names the D34 span of a named Effect function. Anonymous
// callbacks share their caller's span; a variable names only its own lambda.
func (l *execLowering) traceName(n *ast.Node) string {
	mode := l.p.ctx.Tracing
	if mode != "all" && mode != "exported" {
		return ""
	}
	name := ""
	exported := ast.HasSyntacticModifier(n, ast.ModifierFlagsExport)
	switch n.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression:
		if n.Name() != nil {
			name = n.Name().Text()
		}
	case ast.KindMethodDeclaration:
		if ast.IsClassLike(n.Parent) && n.Parent.Name() != nil && n.Name() != nil {
			name = n.Parent.Name().Text() + "." + n.Name().Text()
			exported = ast.HasSyntacticModifier(n.Parent, ast.ModifierFlagsExport)
		}
	}
	if name == "" && n.Parent != nil && n.Parent.Kind == ast.KindVariableDeclaration && ast.IsIdentifier(n.Parent.Name()) {
		name = n.Parent.Name().Text()
		statement := n.Parent.Parent.Parent
		exported = statement != nil && ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport)
	}
	if mode == "exported" && !exported {
		return ""
	}
	return name
}

// traceBodies wraps named Effect bodies in withSpan (D34). Selected
// declarations are left unsplit so neither a same-file fast call nor an
// imported direct call can bypass the span.
func (l *execLowering) traceBodies() {
	bodies := map[int]span{}
	for _, kind := range []editKind{editEffectBody, editContract} {
		for _, s := range l.spans[kind] {
			bodies[l.edits[s.close].pos] = s
		}
	}
	var visit func(*ast.Node)
	visit = func(n *ast.Node) {
		if ast.IsFunctionLike(n) && n.Body() != nil {
			if name := l.traceName(n); name != "" {
				end := n.Body().End()
				if n.Body().Kind == ast.KindBlock {
					end--
				}
				s, ok := bodies[end]
				if !ok {
					s, ok = bodies[n.Body().End()]
				}
				if ok {
					opening := s.open
					if s.middle >= 0 {
						opening = s.middle
					}
					open, _ := renderExec(l.edits[opening])
					close, _ := renderExec(l.edits[s.close])
					at := strings.Index(open, helperRef("$region"))
					if at < 0 {
						at = strings.Index(open, helperRef("$gen"))
					}
					if at >= 0 {
						l.set(opening, open[:at]+helperRef("$withSpan")+"("+open[at:])
						if s.middle >= 0 {
							close = strings.TrimSuffix(close, "}") + ", " + strconv.Quote(name) + ")}"
						} else {
							close += ", " + strconv.Quote(name) + ")"
						}
						l.set(s.close, close)
					}
				}
			}
		}
		n.ForEachChild(func(c *ast.Node) bool { visit(c); return false })
	}
	visit(l.p.file.AsNode())
}

// lowerCallClauseResumes returns the kernel's D18 request for a resume in
// a call-form clause's own frame. Finishing the clause before continuing
// the producer prevents one suspended generator per element. Regions and
// scopes retain ordinary resumes so their cleanup runs after continuation.
func (l *execLowering) lowerCallClauseResumes() {
	r, ok := l.p.forms.(*Resolver)
	if !ok {
		return
	}
	for _, span := range l.spans[editRun] {
		call := l.calls[[2]int{l.edits[span.open].pos, l.edits[span.close].pos}]
		if call == nil {
			continue
		}
		key := r.Callee(call).Canonical
		helper := ""
		switch key {
		case "vibelang-runtime#resume":
			helper = "$tailResume"
		case "vibelang-runtime#resumeWith":
			helper = "$tailResumeWith"
		default:
			continue
		}
		n := call
		for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
			n = n.Parent
		}
		if n.Parent == nil {
			continue
		}
		if n.Parent.Kind == ast.KindReturnStatement {
			n = n.Parent
		}
		fn := n.Parent
		cleanup := false
		for fn != nil && !ast.IsFunctionLike(fn) {
			if fn.Kind == ast.KindTryStatement || fn.Kind == ast.KindBlock && ownsForks(fn) && l.p.holdsScope(fn.Statements()) || l.p.isLoopStatementRegion(fn) {
				cleanup = true
			}
			fn = fn.Parent
		}
		if fn == nil || cleanup {
			continue
		}
		if n.Kind != ast.KindReturnStatement && (fn.Kind != ast.KindArrowFunction || fn.Body() != n) {
			continue
		}
		object := fn.Parent
		if object != nil && ast.IsPropertyAssignment(object) && object.Initializer() == fn {
			object = object.Parent
		}
		if object == nil || !ast.IsObjectLiteralExpression(object) {
			continue
		}
		owner := object.Parent
		if owner == nil || !ast.IsCallExpression(owner) || len(owner.Arguments()) < 3 || owner.Arguments()[2] != object || r.Callee(owner).Canonical != "vibelang-runtime#handle" {
			continue
		}
		l.set(span.open, "")
		l.set(span.close, "")
		l.replace(l.p.tokenStart(call.Expression()), call.Expression().End(), helperRef(helper))
	}
}
