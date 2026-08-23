/**
 * Conservative portability classifier for the current top-level function POC.
 *
 * Known requirement-row under-reporting (deliberately not fixed here):
 *
 * - A call the analyzer can see NO BODY FOR AND CANNOT FOLLOW A VALUE TO enters
 *   nothing. The walk enters the declaration `checker.getResolvedSignature`
 *   selected, and when that declaration is a type or a declaration-file
 *   signature it has no body; `flowValue` then asks the second question — which
 *   value actually reaches this call — and what is left is where neither
 *   question has an answer. It listed EIGHT members, then nine; ELEVEN of those
 *   have since turned out to have an answer to the second question that nothing
 *   was asking for, and all eleven are closed below. SIX remain. Every one of
 *   them was RE-MEASURED reproduction by reproduction against the tree in front
 *   of you, and each says WHY it stays rather than only that it does:
 *
 *     `[1].map(() => process.pid)`, `cbs.forEach((cb) => cb())` over a rest
 *     parameter, `all.get("a")!.read()` where `all` is a `Map`, and `for (const
 *     cb of new Set([cb]))`
 *                                       (ONE boundary in four spellings, and the
 *                                        INTENDED one. The body that would run
 *                                        the callback belongs to
 *                                        `Array.prototype` or `Map.prototype`,
 *                                        which is a declaration file: there is
 *                                        nothing to read, and giving it something
 *                                        to read means the second table of host
 *                                        knowledge this file refuses. It is NOT
 *                                        "a value through a COLLECTION", which is
 *                                        how this log used to put it and which
 *                                        was wrong: a plain object or `Record`
 *                                        literal IS followed, measured — `const
 *                                        all: Record<string, Reader> = { a: {
 *                                        read() { … } } }; all.a!.read()`
 *                                        charges. What is left is a HOST
 *                                        container. And a positional list answers
 *                                        a lookup by INDEX and never one by NAME,
 *                                        so neither an array literal nor a rest
 *                                        parameter holds a `map` or a `forEach`
 *                                        of its own)
 *     `declare const holder: Reader; holder.read()`
 *                                       (an interface member with NO literal and
 *                                        no class anywhere: both questions
 *                                        genuinely have no answer)
 *     `const i = 0; fns[i]!()`          (an array element by a NON-LITERAL index.
 *                                        Exactly ONE element runs and the
 *                                        analyzer cannot say which, so charging
 *                                        every element would report bodies the
 *                                        program never runs — a DIFFERENT rule,
 *                                        not a wider one. That is precisely what
 *                                        separates it from `for (const cb of
 *                                        cbs)`, which is closed below: iterating
 *                                        a list runs EVERY element, so the union
 *                                        there is what runs rather than an
 *                                        over-report. Closing this one needs the
 *                                        index's VALUE, which is a different
 *                                        question from any this file asks —
 *                                        `flowValue` answers "which callable,
 *                                        literal or class", never "which
 *                                        number")
 *     `declare const fns: Array<() => unknown>; run(...fns)`
 *                                       (a SPREAD whose source does not resolve
 *                                        to a list. The spread of a list IS
 *                                        followed now; what is left is the case
 *                                        where nothing decides how MANY values it
 *                                        contributes, so the positional map ends
 *                                        rather than guessing where the values
 *                                        after it land)
 *     `class Impl { set read(v) { … } }; r.read = 1`
 *                                       (a SETTER. MEASURED here for the first
 *                                        time, and it fails open at a CONCRETE
 *                                        receiver too: `invokedAccessors` owns
 *                                        only the get accessor a property READ
 *                                        runs, because only a read runs one, and
 *                                        nothing owns the write. Closing it is a
 *                                        second call site, not a second question)
 *     `const base = { get g() { … } }; run({ ...base })`
 *                                       (an object spread EVALUATES the source's
 *                                        getters where the spread is written and
 *                                        copies their results, so the getter runs
 *                                        at the spread rather than at the read.
 *                                        MEASURED here for the first time. The
 *                                        member lookup below is correct as it
 *                                        stands — a spread produces a DATA
 *                                        property, so no accessor is reachable
 *                                        through it — and what is missing is the
 *                                        read the spread itself performs)
 *   The `.map`/`keep` pair is why the FIRST question is asked exactly this way.
 *   The two are syntactically identical, `keep` is a mandated negative, and no
 *   rule about ARGUMENTS charges one without the other unless the analyzer gains
 *   a second table of host knowledge about `Array.prototype` — which is how this
 *   file has previously shipped an over-correction. What separates them is what
 *   their bodies do: `keep`'s visible body only returns its parameter, `map` has
 *   no visible body at all, and `run`'s calls it. `.map` therefore stays here,
 *   and it stays here for a reason that does not depend on the callback. It
 *   stays here for that reason even now that an array LITERAL is a value: a
 *   positional list answers a lookup by INDEX and never one by NAME, so an array
 *   literal holds no `map` of its own and nothing resolves. The `for…of` closure
 *   below sharpens that rather than weakening it: `for (const cb of cbs)` is
 *   decided by SYNTAX THIS FILE CAN READ, while `cbs.forEach(cb => cb())` sits
 *   next to `[1].map(cb)` and is asserted there.
 * - Module-level STATEMENTS are not analyzed, so what a module's EVALUATION does
 *   beyond its imports is invisible. MEASURED, and RE-MEASURED twice since, most
 *   recently against the tree in front of you: FAILS OPEN. `import "./a.sm"`
 *   where `a.sm` runs `export const contents = readFileSync("x")` charges
 *   nobody, and neither does a bare `void process.pid` statement in an evaluated
 *   module, an unread laundering `const` in the pinned function's OWN module, or
 *   an unread `export const seed = run(() => process.pid)`.
 *   A binding that IS read is charged (that is the initializer scan below, and
 *   the last of those four charges the moment anybody reads `seed`); what
 *   is missing is the effect of a statement nobody reads, which needs a purity
 *   judgement — an unread `const pid = process.pid` is dead code a native
 *   backend may elide, an unread `readFileSync("x")` is not — and guessing at it
 *   would either over-report every unread module constant or keep
 *   under-reporting the side-effecting ones.
 * - A generic capability receiver such as `C extends typeof Config` resolves to
 *   the type parameter rather than the concrete Context subclass. A call to
 *   `capability.context()` therefore contributes no nominal capability.
 *   MEASURED, RE-MEASURED after classes became followable values, and RE-MEASURED
 *   again after values became multi-valued: `[]` where the concrete receiver
 *   reports `["Config"]`. The lost row is a nominal capability, which does not
 *   block a pin, so this entry does NOT fail open. Its stated reason was once
 *   wrong — it said a class reaching a parameter "is neither a callable nor an
 *   object literal", which `flowValue` resolves — and the corrected one is still
 *   true and was re-checked here: the row is produced by `contextRequirement`
 *   READING THE RECEIVER'S TYPE rather than by entering anything, and the type
 *   of a generic receiver is the type parameter whatever value flows into it.
 *   Closing it means teaching `contextRequirement` the value question, not
 *   teaching `flowValue` anything.
 *
 * Two deliberate OVER-reports, both in the fail-closed direction. A callable
 * reached through a reassigned `let` is entered on its initializer's evidence,
 * so `let f = () => process.pid; f = () => 1; f()` charges `Host<"process">`;
 * so is one reached through a reassigned PARAMETER, on the same evidence. And a
 * callee that invokes its parameter is charged whether or not the branch that
 * invokes it can be taken. Refusing a pin the program might have earned is the
 * safe direction; granting one it has not is the direction this file exists to
 * prevent.
 *
 * FAIL-OPEN direction, meaning they can GRANT a certification the specification
 * forbids: the residue of the callable boundary in the first entry, and
 * module-level statements in the second. It was THREE until the module-level
 * ARGUMENT half of value flow was closed, below.
 *
 * This list has been wrong FOUR times. It once asserted that only the
 * module LOAD graph entry fails open and that "every other entry loses a row
 * that only makes a pin harder to obtain"; four entries were then measured
 * granting a pin over a live `process.pid` read. It then called generic
 * capability receivers and Layer provision "unmeasured rather than proven safe";
 * both were measured and Layer provision did fail open. It then stated that
 * the eight members of the FIRST entry were all places where "neither question
 * has an answer"; six of them had an answer to the second question that nothing
 * was asking for, and all six are now charged. And most recently TWO of its
 * members were right in their verdict and wrong in their stated REASON, which is
 * the failure mode that misleads a lane worst:
 *   - the GETTER member said the residue was the accessor resolver not asking
 *     the value question, and offered `new Impl().read` being charged as the
 *     proof. Both halves were true, and the boundary they implied was not:
 *     `const r: { read: unknown } = new Impl(); r.read` — a concrete receiver,
 *     one binding away — was ALSO failing open, because what the checker answers
 *     is the RECEIVER'S TYPE'S member and an annotation replaces it. Measured.
 *   - the COLLECTION member named "a value that passes through a collection",
 *     which reads as a shape this file cannot follow. It already could: an
 *     object or `Record` literal is followed and charges. What was left is a
 *     HOST container, which is the `.map` boundary under another name.
 * An entry here is fail-closed only once someone has measured it, and no entry
 * above is left unmeasured. Every surviving entry above has been RE-MEASURED,
 * reproduction by reproduction, against the tree in front of you rather than
 * inherited — and a member that stays is required to say WHY it stays rather
 * than only that it does, because a correct verdict resting on a stale reason
 * has already cost this file a lane.
 *
 * LAYER PROVISION is NOT in this list any more, and must not return to it. It
 * was one entry covering two failures — the classifier neither subtracted what a
 * layer provides nor reported an unsatisfied nested row — because ONE skip
 * caused both: the callback was never entered, so a satisfied row and an
 * unsatisfied one were equally empty, and `Layer.provide(layer, () =>
 * process.pid)` kept a native pin over a live host read. `layerProvision` reads
 * the two Locked sentences directly. Scoping: the callback runs, so it is
 * entered. Satisfaction: "Providing a layer to a computation MUST remove
 * matching capabilities from the computation's unsatisfied requirement row", so
 * `layerProvides` resolves the layer expression exactly as the frontend's
 * `resolveLayerExpression` does and the closure is subtracted — at the call
 * graph edge too, so the subtraction survives propagation. What a layer cannot
 * provide is never subtracted: `charge` refuses to drop any requirement
 * `blocksNativePin` recognizes, so `abstract class TypeScript extends Context`
 * cannot buy a pin, and an opaque layer subtracts nothing at all. This is NOT
 * the second table of host knowledge the `.map` boundary refuses: Layer Algebra
 * is Locked as "library-shaped; the compiler recognizes their effect on `R`",
 * the recognition is checker symbol identity against this analyzer's own
 * prelude, and a user's `Layer.provide` resolves elsewhere and stays ordinary.
 * Both directions are asserted.
 *
 * A callable reached by VALUE FLOW is NOT in this list any more either, and must
 * not return to it. `run(cb)` whose body calls `cb()`, `const holder: Reader =
 * { read() { … } }; holder.read()`, and `(g = () => process.pid) => g()` each ran
 * a visible body and charged nothing, because the signature the checker selected
 * was a parameter's function type or an interface member. `flowValue` answers
 * the other question — which literal reaches this call — from the syntax that
 * produced the value: a literal, an initializer, a parameter default, or the
 * argument bound to a parameter. The rule is NOT "charge callback arguments",
 * which would charge the mandated negative `keep(() => process.pid)` and its
 * identical twin `[1].map(() => process.pid)` alike; it is ENTER THE CALLEE'S
 * VISIBLE BODY AND CHARGE WHAT THAT BODY INVOKES, so `run` charges, `keep` does
 * not, and `.map` stays undecidable for want of a body. `followBindings` is
 * keyed by the callee AND the callables bound to its parameters, which is finite
 * (both come from the program's own nodes) and therefore terminating, and which
 * two call sites handing one callee two different callbacks require — keying on
 * the callee alone would drop the second, the fail-open direction. Building a
 * closure around a parameter is still not running it, and every protected
 * negative is re-asserted INSIDE a callable entered this way.
 *
 * The MODULE-LEVEL half of that same argument rule is NOT in this list any more
 * either, and must not return to it. `export const value = run(() =>
 * process.pid)` charged nobody while the byte-identical shape inside an analyzed
 * body was charged, and the initializer walk's OTHER value-flow answers — an
 * annotated binding's method, a parameter default — already worked there,
 * because they need no environment. The fix is the SAME rule applied in the same
 * place, not a second rule for module level: `foreignEdgeInExpression` gained
 * `follow`, the exact counterpart of the body walk's `followBindings`, so a
 * module initializer enters the callee's visible body and charges only what that
 * body invokes. `keep` and `.map` are unaffected at module level and in a body
 * alike, and both are asserted side by side in one reproduction.
 *
 * TWO CORRECTIONS this closure produced, both measured, because the entry it
 * replaced stated its own fix and stated it wrong:
 *   1. It claimed closing this needed `foreignEdgeInExpression`'s ENTERED-callable
 *      set to be re-keyed by the bound arguments. FALSE, and re-keying it that
 *      way is the mistake to avoid: `walk.entered` is what stops a callable from
 *      being walked twice, and re-keying it would let C50's and C53's asserted
 *      routes be re-derived. The correct re-key is a SECOND set, `walk.followed`,
 *      keyed by `(callee, callables bound to its parameters)` — which is exactly
 *      how the body walk is built, with `entered` and `followed` side by side.
 *      No route-bearing invariant was changed; every prior asserted route is
 *      byte-identical, measured.
 *   2. It implied the module-level half failed open wholesale. It did not: a
 *      MODULE edge inside a deferred argument (`run(() => readFileSync("x"))`)
 *      was already charged, because the module-edge channel deliberately searches
 *      inside closures and over-reports. Only the AMBIENT channel failed open,
 *      and that is the half `follow` closes.
 *
 * SIX MORE SPELLINGS of that same second question are NOT in this list any more
 * either, and must not return to it. Each ran a visible body and charged
 * nothing, and each was listed as undecidable when only ONE of the two questions
 * had no answer:
 *   `run(new Impl())`      — a CLASS INSTANCE. The class declaration and the
 *                            method body are both visible; `classMemberValue`
 *                            reads them, own members first so an OVERRIDE wins
 *                            over the base it replaces, then the `extends`
 *                            chain, so an INHERITED method is reached too. A get
 *                            accessor ENDS the lookup, because `invokedAccessors`
 *                            owns the property read.
 *   `run(make())`          — a CALL RESULT is the value its callee RETURNS.
 *                            `flowReturnValue` is the existing "enter the
 *                            visible body" rule asked about a `return`, with the
 *                            callee's own parameters bound first so an identity
 *                            factory is followed too.
 *   `fns[0]!()`            — an ARRAY LITERAL element. An array literal is a
 *                            POSITIONAL list, read back by index.
 *   `run(...cbs)` receiving `cbs[0]!()` — a REST parameter collects the
 *                            remaining arguments into that same positional list.
 *   `run({ cb })`          — a DESTRUCTURED parameter, bound member by member
 *                            from the object literal the caller passed, with the
 *                            element's own default answering only for a property
 *                            the caller omitted.
 *   ``tag`x${cb}` ``       — a TAGGED TEMPLATE. This one was previously left
 *                            alone for want of a mapping, and the mapping is
 *                            READ rather than guessed: ECMAScript evaluates
 *                            ``tag`a${x}b${y}` `` as `tag(strings, x, y)`, which
 *                            is the same correspondence the CHECKER uses to
 *                            select the tag's signature and the same one
 *                            `isInvokedWhereDefined` already relies on to treat
 *                            a tag as invoked. The mapping is positional and the
 *                            precision is asserted: a tag that invokes only its
 *                            FIRST substitution does not charge the second.
 * None of this is a rule about ARGUMENTS and none of it consults host knowledge:
 * every one goes through `flowValue` into the same "enter the callee's visible
 * body and charge what that body invokes" walk, so `keep` and `.map` are
 * untouched — asserted at module level, in a body, and one level deeper inside a
 * callable entered through EACH of the six new channels.
 *
 * FIVE MORE SPELLINGS are NOT in this list any more either, and must not return
 * to it. Each ran a visible body and charged nothing, in a body AND at module
 * level, and none of them needed a new kind of question — three needed the
 * SECOND question asked at a place that was not asking it, and two needed the
 * value model to stop carrying exactly one value:
 *   `run(new Impl())` where the callee READS `r.read`
 *                        — a GETTER. `invokedAccessors` asked the CHECKER which
 *                          symbol the property name resolves to and stopped
 *                          there, so it answered only when the receiver's type
 *                          already named the accessor; an interface, a
 *                          structural annotation or a parameter type replaced it
 *                          with a member that has no body. It now asks the
 *                          checker FIRST and the value question second, exactly
 *                          as `invokedCallables` does for a call, and
 *                          `accessorOfValue` looks the accessor up in the object
 *                          literal or class the value resolved to — own members
 *                          first, so a CLEAN override of a host-reading base
 *                          stays clean, and a member of that name that is not an
 *                          accessor ends the lookup because that is what the
 *                          read reaches.
 *   `run(...[cb])`       — a SPREAD argument. Once an array literal is a
 *                          positional list, the values a spread contributes are
 *                          READ from that list rather than guessed at, exactly as
 *                          the tagged template's mapping was read from
 *                          ECMAScript. `positionalValues` flattens it for a
 *                          call's arguments and an array literal's elements
 *                          alike. It is POSITIONAL and not "charge every element
 *                          of the spread": a callee that invokes only its FIRST
 *                          parameter does not charge the second element, and that
 *                          is asserted. A spread whose source does not resolve to
 *                          a list still ends the mapping, because nothing decides
 *                          how many values it contributes.
 *   `for (const cb of cbs) { cb() }`
 *                        — a rest parameter, or any list, ITERATED. Iterating a
 *                          list runs the body for EVERY element, so the union of
 *                          the elements is exactly what runs. This is the member
 *                          most easily mistaken for the non-literal-index one
 *                          above and it is its opposite: there ONE element runs
 *                          and the analyzer cannot say which, so a union would
 *                          over-report. `cbs.forEach(cb => cb())` is NOT closed
 *                          and must not be: the body that would call the callback
 *                          is `Array.prototype.forEach`'s.
 *   `run({ ...base })`   — an object SPREAD. A spread republishes OWN ENUMERABLE
 *                          properties, and that one sentence decides every half
 *                          of it: an object literal's members are own properties
 *                          and are republished; a class's METHODS live on its
 *                          prototype and are NOT, so `{ ...new Impl() }.read` is
 *                          `undefined` at run time and is deliberately left
 *                          alone (the checker's spread type is wider than the
 *                          language here, and this follows the language); a
 *                          class's own instance PROPERTY is copied and is
 *                          republished. Members are scanned in SOURCE ORDER and
 *                          the LAST match wins, so an explicit member after the
 *                          spread overrides it and one before it does not.
 *   `function make(n) { if (n) { return () => 1 } return () => process.pid }`
 *                        — a factory with MORE THAN ONE resolvable return. It was
 *                          followed to the FIRST, which made the verdict an
 *                          accident of source order: the same program with its
 *                          returns swapped was already charged. Every return is
 *                          followed now and the row is their UNION, which is the
 *                          same fail-closed reading of an undecided branch this
 *                          file already applies to a conditional invocation, and
 *                          the same Locked sentence: the pin is checked over the
 *                          "complete transitive graph … any reachable
 *                          operation". A `return` whose expression is a
 *                          CONDITIONAL is the same thing spelled differently and
 *                          is decided the same way.
 * The mechanism for the last two is `FlowUnion`, and it is the one structural
 * change: `FlowValue` can now stand for SEVERAL values, every consumer that has
 * to pick a callable, a literal or a class goes through `flowOptions` and walks
 * all of them, and `invokedCallable`/`invokedAccessor` became
 * `invokedCallables`/`invokedAccessors`. The checker's answer is still taken
 * ALONE when it has one — it is the declaration the call site selected — so a
 * union only ever appears where the value question was already the only answer.
 * `keep` and `.map` are untouched, asserted at module level, in a body, and one
 * level deeper inside a callable entered through EACH of these five channels and
 * each of the previous lane's six.
 *
 * TWO THINGS THE NEXT LANE SHOULD NOT REPEAT, both measured here:
 *   1. `walk.entered`/`entered` were NOT re-keyed and no set was re-keyed, by
 *      two lanes running. The only new state is inside `flowValue`'s own `seen`,
 *      which holds callables and classes as well as symbols, and `bindingsKey`
 *      keys a positional list — and now a UNION — STRUCTURALLY (`flowValueKey`)
 *      because both are rebuilt at every call and identity would never converge.
 *      A union's key is its SORTED members, so the same set reached two ways is
 *      one key.
 *   2. A form that charges nothing because the ANALYZER cannot see it is a
 *      residue and belongs in this header. It must never be filed as a negative
 *      in `classify.test.ts`. Two lanes did that — a call result in the body
 *      walk's table, and a rest parameter, a destructured parameter, a call
 *      result, an array element and a tagged template in the module-level one —
 *      and the lane that closed them had to unpick six assertions that recorded
 *      bugs as facts. Each was replaced in place by the true negative it stood
 *      next to: reaching a value through that spelling is still not INVOKING it.
 *
 * Termination is by the same argument as the body walk's, with the load graph
 * and binding cycles on top: both halves of the key come from the program's own
 * syntax nodes, so the key space is finite and a monotone set terminates. The
 * cycles classes, return-value analysis, getters and unions add are carried by
 * `flowValue`'s `seen`, which is monotone over the same finite set of nodes and
 * symbols. A union does not enlarge that set: its members are values already
 * reachable, `flowUnion` de-duplicates them by the structural key, and the key
 * of a union is its members' keys SORTED, so the key space stays finite. It is
 * asserted on a method returning an instance of its own class, mutually
 * recursive factories in both directions, a self-referential array binding, a
 * self-referential list a `for…of` iterates, a rest parameter iterated and
 * forwarded to itself, a getter that reads itself, a class hierarchy three deep,
 * a class reached through an alias, and — the case a careless key drops — two
 * different values through one callee, once per channel.
 * Asserted on recursion, on mutual recursion with the charge BEHIND the cycle,
 * on a self-referential binding, on a cross-module binding cycle, and — the case
 * a careless re-key breaks — on two different callables through one callee, in
 * both the direct and the forwarded spelling.
 *
 * A callable INVOKED WHERE IT IS DEFINED is NOT in this list any more, and must
 * not return to it. `export const pid = (() => process.pid)()` is the same host
 * read as `export const pid = process.pid`, and it hid behind the function
 * boundary both walks stop at, in the body walk and the initializer scan alike.
 * `isInvokedWhereDefined` draws that boundary at INVOCATION rather than at
 * definition, from syntax at the definition site: the callable must BE the
 * callee (`(fn)()`, `fn?.()`, `new (fn)()`, a tagged template's tag,
 * `fn.call`/`fn.apply`, `fn.bind(...)()`).
 * DEFINITION stays ordinary and is asserted in both directions — `const
 * deferred = () => window.location`, a callable stored or passed without being
 * invoked, and `fn.bind(null)` with no call all charge nothing. Descending into
 * nested callables instead of testing invocation is how a first attempt at this
 * broke the `deferred` assertion; it must not be tried again.
 *
 * A callable REACHED THROUGH a binding, a member, or another call's result is
 * NOT in this list any more either, and must not return to it. It was three
 * entries — indirect and higher-order calls, object-literal and class methods,
 * and module-level calls — and all three were one defect: propagation needed a
 * callee IDENTIFIER whose symbol was an analyzed top-level function, so
 * `alias()`, `holder.read()`, `C.m()`, `new C().m()`, `make()()`, `holder.g`
 * and a module-level `helper()` each ran a visible body and charged nothing.
 * `invokedCallables` asks the checker which signature the call selected, which is
 * the same question the FRONTEND asks (`resolveLocalCallee` in
 * `src/language/semantic.ts`), so the two rows now agree by construction instead
 * of the classifier reporting `[]` where the frontend reported `["Config"]`. An
 * analyzed top-level function still travels the CALL GRAPH rather than being
 * inlined, so its retained path keeps naming it. NAMING a callable is still not
 * using it: `typeof holder.m`, `keep(holder.m)`, an object literal or class
 * merely built, and a getter merely defined all stay ordinary, and each is
 * asserted.
 *
 * The module LOAD graph is NOT in this list any more, and must not return to it.
 * A side-effect import is evaluated unconditionally, and so is everything the
 * module it names side-effect imports, so `collectLoadGraph` follows the chain
 * and `recordModuleLoad` charges it at every project module a binding walk
 * crosses. Until it did, `import "./a.sm"` where `a.sm` runs `import "node:fs"`
 * charged nobody. What is charged is a module's EVALUATION, never its exports:
 * a module that re-exports `node:fs` and is read for a clean binding still
 * charges nothing, because a re-export publishes an elidable binding rather than
 * evaluating anything the reader did not ask for. That precision is C41's, C40
 * spent a lane restoring it, and it is asserted in both directions.
 *
 * A re-export is NOT in this list any more, and must not return to it.
 * `requirementsForImportedReference` follows a binding across re-exports,
 * namespace exports, star exports, and value bindings until it reaches the
 * module that owns it; until it did, any project module could launder a foreign
 * edge (`export { readFileSync } from "node:fs"`) and the pin was granted with
 * no diagnostic while the direct import of the same function refused it.
 *
 * Ambient authority in a module-level initializer is NOT in this list any more
 * either, and must not return to it. A binding whose initializer captured
 * `process`/`Date`/`Math`/`performance`/`crypto` charges every reader of that
 * binding, because the initializer runs when the module loads and reading a
 * constant that HOLDS host state is reading host state. Until it did,
 * `export const pid = process.pid` laundered a host global through a
 * plain-looking constant and a function reading `pid` was certified
 * native-portable, while the identical `process.pid` in its own body was
 * charged `Host<"process">`. The classification is the analyzer's existing
 * ambient table applied at the initializer — never a second table — so
 * `Date.parse`/`Date.UTC`, `new Date(0)`, `Math.max` and a LEXICALLY SHADOWED
 * root stay ordinary by construction rather than by a second opinion. Both
 * directions are asserted in `classify.test.ts`.
 *
 * These boundaries are regression-visible as `test.todo` entries in
 * `classify.test.ts`. This file must not be treated as a complete effect or
 * higher-order data-flow analysis until those entries are replaced by passing
 * assertions.
 */
import * as ts from "typescript-js";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { recoverSmithersSyntax, type RecoveredSource } from "../language/recover.ts";

export type Portability = "portable" | "typescript-required" | "forbidden" | "undecided";

export interface PortabilityDiagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
}

export interface FunctionCompatibility {
  name: string;
  requirements: string[];
  requirementPaths: Record<string, string[]>;
  nativePinned: boolean;
}

export interface CompatibilityAnalysis {
  functions: Record<string, FunctionCompatibility>;
  diagnostics: PortabilityDiagnostic[];
}

interface Facts {
  name: string;
  key: string;
  node: ts.FunctionDeclaration;
  nativePinned: boolean;
  /**
   * The authored `native(...)` call that pinned this function. A pin may be
   * written in a different module from the declaration it pins, and the
   * assertion is what failed, so a pin diagnostic is reported here rather than
   * at the declaration.
   */
  pin?: { file: ts.SourceFile; node: ts.Node };
  direct: Map<string, string[]>;
  /**
   * `provided` is the capability closure that was in scope where the call was
   * written. Locked: "Providing a layer to a computation MUST remove matching
   * capabilities from the computation's unsatisfied requirement row"
   * (`specification/requirements.mdx`, Satisfaction), and a call inside a
   * `Layer.provide` body is part of that computation, so the subtraction has to
   * survive propagation rather than only applying to what the callback charged
   * directly. It is the shared EMPTY set for every ordinary call, which is what
   * keeps the fixpoint's behaviour unchanged everywhere else.
   */
  calls: Array<{ callee: Facts; node: ts.Node; provided: ReadonlySet<string> }>;
  symbol?: ts.Symbol;
}

/** The capability closure of an unprovided context: shared, so identity works. */
const NOTHING_PROVIDED: ReadonlySet<string> = new Set<string>();

/**
 * Several values reached POSITIONALLY: an array literal's elements, or the
 * arguments a rest parameter collected. Both are the same shape — a list whose
 * members are read back by index — so one representation serves both, and a
 * member lookup by NAME on a list resolves to nothing, which is what keeps
 * `[1].map(cb)` undecidable now that an array literal is a value at all.
 */
interface FlowList {
  readonly values: readonly (FlowValue | undefined)[];
}

/**
 * SEVERAL values, where the program decides at run time which one arrives: the
 * callables a factory's different `return`s hand back, the two branches of a
 * conditional, or the elements a `for…of` binds its variable to in turn.
 *
 * EVERY one of them can reach the call, so every one is followed and the row is
 * their union. That is the same fail-closed reading of an undecided branch this
 * file already applies — "a callee that invokes its parameter is charged whether
 * or not the branch that invokes it can be taken" — and it comes from the same
 * Locked sentence: a native pin is checked over the "complete transitive graph …
 * any reachable operation" (`specification/compatibility.mdx`).
 *
 * It is deliberately NOT the answer for an element read by an unknown INDEX.
 * There exactly ONE element runs and the analyzer cannot say which, so charging
 * all of them would report operations the program never performs — a different
 * rule, not a wider one. That stays open and is named in the header.
 */
interface FlowUnion {
  readonly options: readonly FlowValue[];
}

/**
 * A resolved value: a callable, an object literal, a class, a positional list,
 * or several of those at once. A class is here because `run(new Impl())` reaches
 * a method body through the class declaration rather than through any literal.
 */
type FlowValue =
  | ts.FunctionLikeDeclaration
  | ts.ObjectLiteralExpression
  | ts.ClassLikeDeclaration
  | FlowList
  | FlowUnion;

/**
 * The symbols and callables already visited while resolving one value. It holds
 * both because a value can now travel through a binding (a symbol) and through a
 * factory's return (a callable), and either can be cyclic.
 */
type FlowSeen = Set<ts.Symbol | ts.Node>;

const NO_BINDINGS: ReadonlyMap<ts.Symbol, FlowValue> = new Map<ts.Symbol, FlowValue>();

/** The elements of a positional value, or `undefined` for every other value. */
function flowList(value: FlowValue | undefined): readonly (FlowValue | undefined)[] | undefined {
  return value !== undefined && Array.isArray((value as FlowList).values)
    ? (value as FlowList).values
    : undefined;
}

/**
 * The values a resolved value stands for: the members of a union, or the value
 * itself. Every consumer that has to pick a callable, a literal or a class goes
 * through this, which is what makes "several values reach this call" a walk over
 * all of them rather than a silent choice of the first.
 */
function flowOptions(value: FlowValue | undefined): readonly FlowValue[] {
  if (value === undefined) return [];
  const options = (value as FlowUnion).options;
  return Array.isArray(options) ? options : [value];
}

/**
 * One value standing for all of these, flattened and de-duplicated by the same
 * STRUCTURAL key termination uses. Empty collapses to `undefined` and a single
 * option collapses to itself, so nothing that resolved to exactly one value
 * before is wrapped now.
 */
function flowUnion(values: readonly (FlowValue | undefined)[]): FlowValue | undefined {
  const options: FlowValue[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    for (const option of flowOptions(value)) {
      const key = flowValueKey(option);
      if (keys.has(key)) continue;
      keys.add(key);
      options.push(option);
    }
  }
  if (options.length === 0) return undefined;
  return options.length === 1 ? options[0]! : { options };
}

/** The value as a node, or `undefined` when it is a positional list or a union. */
function flowNode(value: FlowValue | undefined): ts.Node | undefined {
  if (value === undefined || flowList(value) !== undefined) return undefined;
  return Array.isArray((value as FlowUnion).options) ? undefined : value as ts.Node;
}

function asCallable(value: FlowValue | undefined): ts.FunctionLikeDeclaration | undefined {
  const node = flowNode(value);
  return node !== undefined && ts.isFunctionLike(node) ? node as ts.FunctionLikeDeclaration : undefined;
}

function asObjectLiteral(value: FlowValue | undefined): ts.ObjectLiteralExpression | undefined {
  const node = flowNode(value);
  return node !== undefined && ts.isObjectLiteralExpression(node) ? node : undefined;
}

function asClass(value: FlowValue | undefined): ts.ClassLikeDeclaration | undefined {
  const node = flowNode(value);
  return node !== undefined && ts.isClassLike(node) ? node : undefined;
}

interface RuntimeImports {
  /**
   * Requirement to the route that reaches it. The route is EMPTY when this file
   * imports the foreign module itself, which keeps the retained path of a direct
   * side-effect import exactly what it has always been; it names each project
   * module of the load chain, ending at the foreign specifier, when the edge was
   * reached through another module's evaluation.
   */
  readonly sideEffects: ReadonlyMap<string, readonly string[]>;
}

/** Nominal capability row names keyed by the checker symbol of their class. */
interface CapabilityNaming {
  bySymbol: ReadonlyMap<ts.Symbol, string>;
}

const COMPILER_PROJECT_ROOT = resolve("/smithers-compat-project");
const COMPILER_PRELUDE_NAME = resolve(COMPILER_PROJECT_ROOT, "__smithers_target_prelude__.d.ts");

/**
 * Checker-only declarations for the compiler-owned modules, mirroring the
 * frontend prelude in `src/language/semantic.ts` and the backend's
 * `CONTEXT_DECLARATIONS` in `portable-backend.ts`. Without them `Context` never
 * resolves here, so every `Capability.context()` read was silently reported as
 * requiring nothing at all.
 *
 * Nothing in this text has a runtime value, and `checkedProject` refuses to
 * resolve any compiler-owned specifier to a file, so `smthrs/context` can
 * only ever bind to this declaration and never to installed code.
 */
const COMPILER_PRELUDE = String.raw`
declare module "smthrs/context" {
  export abstract class Context {
    static context<C extends abstract new (...args: never[]) => Context>(this: C): InstanceType<C>
  }
}

declare module "smthrs/provider" {
  import type { Context } from "smthrs/context"
  export interface Layer<P> {
    readonly __smithersLayer: { readonly provides: P }
  }
  export const Layer: {
    succeed<C extends abstract new (...args: never[]) => Context>(capability: C, implementation: InstanceType<C>): Layer<C>
    merge<const L extends readonly Layer<unknown>[]>(...layers: L): Layer<L[number] extends Layer<infer P> ? P : never>
    provide<L extends Layer<unknown>, A>(layer: L, body: () => A): A
  }
}

declare module "smithers:native" {
  /**
   * The native pin: native(fn) asserts that fn's complete transitive
   * dependency graph runs without the built-in TypeScript requirement. It is a
   * compile-time assertion with no runtime effect, so it returns its own
   * argument and a pin may be written either as a bare statement next to the
   * declaration or around a reference to it.
   */
  export function native<F extends (...args: never[]) => unknown>(pinned: F): F
}
`;

/**
 * The compiler-owned module the native pin is imported from, spelled in the
 * colon form `smithers:comptime` and `smithers:exceptions` already use. The
 * pin is recognized through the checker symbol declared above and never
 * through the local spelling of the binding, so a renamed import and a
 * namespace read both pin, and an unrelated local `native` never does.
 */
const NATIVE_PIN_MODULE = "smithers:native";
const NATIVE_PIN_INTRINSIC = "native";

const undecidedGlobals = new Set(["Proxy", "WeakRef", "FinalizationRegistry"]);
const hostGlobals = new Set([
  "process",
  "window",
  "document",
  "console",
  "fetch",
  "setTimeout",
  "setInterval",
  "globalThis",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Authored coordinates for a module whose checked Program was built over the
 * frontend's recovered text.
 *
 * Every analyzed source is authored Smithers, which diverges from the
 * TypeScript grammar in general expression positions: `defer`, `break :label
 * value`, loop `else`, `if (const x = f(); cond)`, and value-position
 * `if`/`switch`. Stock TypeScript cannot parse those, so this analyzer would
 * see a shredded AST and silently under-report requirements. It runs the same
 * pre-parse recovery the frontend runs (`recoverSmithersSyntax`) and checks the
 * derived text instead.
 *
 * Recovery is NOT length-preserving — it hoists constructs to compiler
 * temporaries declared before their containing statement — so a derived offset
 * is not an authored offset. Every portability diagnostic is source-located,
 * so `at()` maps its node back through the recovery's exact piecewise map and
 * takes the line and column from the AUTHORED text. A module with no divergent
 * syntax recovers to itself, and then this file behaves exactly as before.
 */
interface AuthoredPositions {
  readonly recovery: RecoveredSource;
  readonly lineStarts: readonly number[];
}

const authoredPositions = new WeakMap<ts.SourceFile, AuthoredPositions>();

function computeLineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function locateOffset(
  starts: readonly number[],
  offset: number,
): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}

/**
 * A checker-side experiment for the three-way portability table and native-pin
 * dependency diagnostics. The pin spelling is PROVISIONAL: the ledger still
 * lists it as open, and this file proposes the imported-intrinsic form
 * `native(fn)` from `"smithers:native"` rather than closing that decision.
 */
export function analyzeCompatibility(source: string): CompatibilityAnalysis {
  const { files, checker, projectFiles, prelude } = checkedProject({ "compat.sm.ts": source });
  return analyzeChecked(files, checker, projectFiles, prelude, false);
}

/** Checker-backed multi-module analysis used by native-pin graph validation. */
export function analyzeCompatibilityProject(
  sources: Readonly<Record<string, string>>,
): CompatibilityAnalysis {
  const checked = checkedProject(sources);
  return analyzeChecked(checked.files, checked.checker, checked.projectFiles, checked.prelude, true);
}

function analyzeChecked(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  prelude: ts.SourceFile,
  qualifyNames: boolean,
): CompatibilityAnalysis {
  const diagnostics: PortabilityDiagnostic[] = [];
  const facts = new Map<string, Facts>();
  const factsBySymbol = new Map<ts.Symbol, Facts>();
  const capabilityNaming = buildCapabilityNaming(files, checker);
  for (const file of files) {
    for (const statement of file.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
      const symbol = checker.getSymbolAtLocation(statement.name);
      const fileName = portableFileName(file.fileName);
      const key = qualifyNames ? `${fileName}#${statement.name.text}` : statement.name.text;
      const fact: Facts = {
        name: key,
        key,
        node: statement,
        nativePinned: false,
        direct: new Map(),
        calls: [],
        symbol,
      };
      facts.set(key, fact);
      if (symbol) factsBySymbol.set(symbol, fact);
      // The POC's earlier marker. It is retired rather than silently ignored:
      // a marker that used to be a checked assertion and now does nothing is
      // worse than no marker at all.
      const retired = ts.getJSDocTags(statement).find((tag) => tag.tagName.text === NATIVE_PIN_INTRINSIC);
      if (retired) {
        diagnostics.push(at(
          file,
          retired,
          "SMITHERS3006",
          `the /** @${NATIVE_PIN_INTRINSIC} */ marker no longer pins a function; import { ${NATIVE_PIN_INTRINSIC} } from ${JSON.stringify(NATIVE_PIN_MODULE)} and write ${NATIVE_PIN_INTRINSIC}(${statement.name.text})`,
          "warning",
        ));
      }
    }
  }

  collectNativePins(files, checker, prelude, factsBySymbol, diagnostics);

  const loadGraphs = new Map<ts.SourceFile, RuntimeImports>();
  const runtimeImportsOf = (file: ts.SourceFile): RuntimeImports => {
    const cached = loadGraphs.get(file);
    if (cached) return cached;
    const computed = collectRuntimeImports(file, checker, projectFiles);
    loadGraphs.set(file, computed);
    return computed;
  };
  const factsByNode = new Map<ts.Node, Facts>();
  for (const fact of facts.values()) factsByNode.set(fact.node, fact);

  for (const fact of facts.values()) {
    const file = fact.node.getSourceFile();
    // The module LOAD graph, now transitive: what this file's evaluation
    // unconditionally evaluates, and what THOSE modules evaluate in turn. The
    // route is empty for this file's own edge, so a direct side-effect import
    // keeps the path it has always had.
    for (const [requirement, hops] of runtimeImportsOf(file).sideEffects) {
      addRequirement(fact, requirement, [fact.name, ...hops]);
    }
    const isUnboundGlobal = (node: ts.Identifier): boolean => isAmbientReference(node, checker, file);
    const markAnyInType = (node: ts.Node | undefined): void => {
      if (!node) return;
      if (node.kind === ts.SyntaxKind.AnyKeyword) addRequirement(fact, "TypeScript", [fact.name]);
      ts.forEachChild(node, markAnyInType);
    };
    for (const parameter of fact.node.parameters) markAnyInType(parameter.type);
    markAnyInType(fact.node.type);
    // Callables already entered for this function. Monotone: a callable
    // contributes the same requirements however it was reached, so entering it
    // once is enough, and never removing an entry is what terminates a
    // recursive or mutually recursive call chain.
    const entered = new Set<ts.Node>();
    /**
     * A requirement charged to this function, unless the scope it was reached in
     * already provides it.
     *
     * A BLOCKING requirement is never subtractable, whatever a layer claims to
     * provide. `Host<...>`, `Module<...>` and the built-in `TypeScript` name a
     * JavaScript host rather than a nominal capability, and a row name is just a
     * class name, so `abstract class TypeScript extends Context {}` would
     * otherwise let `Layer.succeed(TypeScript, ...)` subtract the one
     * requirement a pin exists to reject. That is the fail-open direction, so
     * the guard is here rather than in the layer resolver.
     */
    const charge = (
      requirement: string,
      route: readonly string[],
      provided: ReadonlySet<string>,
    ): void => {
      if (provided.has(requirement) && !blocksNativePin(requirement)) return;
      addRequirement(fact, requirement, route);
    };
    const enterInvoked = (
      callable: ts.FunctionLikeDeclaration | undefined,
      route: readonly string[],
      provided: ReadonlySet<string>,
    ): void => {
      // A callable written AT the call is already walked where it stands, with
      // the enclosing route: naming it as a hop would add a name the reader can
      // see anyway. Only a callable reached THROUGH something gains a hop.
      if (callable === undefined || isInvokedWhereDefined(callable)) return;
      // An analyzed top-level function keeps its CALL-GRAPH edge instead: the
      // fixpoint already propagates its row with the retained path that names
      // it, and inlining it here would charge the same requirement one hop
      // earlier and replace that path with a shorter, less useful one.
      const called = factsByNode.get(callable);
      if (called) {
        if (
          called !== fact &&
          !fact.calls.some((existing) => existing.callee === called && existing.provided === provided)
        ) {
          fact.calls.push({ callee: called, node: callable, provided });
        }
        return;
      }
      if (entered.has(callable)) return;
      entered.add(callable);
      ts.forEachChild(callable, (child) => visit(child, hopped(route, callable, qualifyNames), provided));
    };
    /**
     * VALUE FLOW: the callables that reached a callee's parameters, entered
     * where that callee's own visible body actually invokes them.
     *
     * This is deliberately NOT a rule about arguments. `keep(() => process.pid)`
     * and `[1].map(() => process.pid)` are syntactically identical, `keep` is a
     * mandated negative, and any rule that charges an argument charges both —
     * which is how this file has previously shipped an over-correction. The rule
     * here is the one the two shapes DISAGREE about: enter the callee's visible
     * body and charge only what that body invokes. `run(cb)` charges because
     * `run`'s body calls `cb()`; `keep(cb)` does not because `keep`'s body only
     * returns it; `.map(cb)` stays undecidable because `lib.d.ts` has no body to
     * read. No host knowledge about `Array.prototype` is consulted, and none is
     * needed.
     *
     * Only a callable the bindings resolve DIFFERENTLY from the ordinary
     * resolution is charged here. Everything a callee's body does on its own is
     * already this analyzer's business — through the call graph when the callee
     * is an analyzed function, through `enterInvoked` when it is not — so this
     * walk adds exactly the argument's contribution and never a second copy of
     * the callee's.
     *
     * TERMINATION. `followed` is keyed by the callee AND the callables bound to
     * its parameters. Both come from a FINITE set — the program's own syntax
     * nodes — so the key space is finite and the monotone set terminates every
     * recursive and mutually recursive chain. It is keyed on the pair rather
     * than on the callee alone because two call sites can hand the same callee
     * two different callables, and dropping the second is the fail-open
     * direction.
     */
    const followed = new Set<string>();
    const followBindings = (
      callee: ts.FunctionLikeDeclaration,
      bindings: ReadonlyMap<ts.Symbol, FlowValue>,
      route: readonly string[],
      provided: ReadonlySet<string>,
    ): void => {
      if (bindings.size === 0) return;
      const key = bindingsKey(callee, bindings);
      if (followed.has(key)) return;
      followed.add(key);
      const step = (node: ts.Node): void => {
        // BUILDING a callable is not running it, here as everywhere else: a
        // callee that wraps its parameter in a closure it returns has not
        // invoked it.
        if (ts.isFunctionLike(node) && !isInvokedWhereDefined(node)) return;
        if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
          const ordinary = invokedCallables(node, checker, projectFiles);
          const flowed = invokedCallables(node, checker, projectFiles, bindings);
          for (const target of flowed) {
            if (!ordinary.includes(target)) enterInvoked(target, route, provided);
          }
          for (const target of flowed.length === 0 ? ordinary : flowed) {
            followBindings(
              target,
              argumentBindings(target, node, bindings, checker, projectFiles),
              isInvokedWhereDefined(target) ? route : hopped(route, target, qualifyNames),
              provided,
            );
          }
        }
        // A property READ runs a getter, and which getter it runs is the same
        // value question a call asks. `run(r) { return r.read }` reached
        // `Impl`'s accessor only when the checker had already named it.
        if (ts.isPropertyAccessExpression(node)) {
          const ordinary = invokedAccessors(node, checker, projectFiles);
          for (const accessor of invokedAccessors(node, checker, projectFiles, bindings)) {
            if (!ordinary.includes(accessor)) enterInvoked(accessor, route, provided);
          }
        }
        ts.forEachChild(node, step);
      };
      ts.forEachChild(callee, step);
    };
    const enterCall = (
      node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
      route: readonly string[],
      provided: ReadonlySet<string>,
    ): void => {
      for (const callee of invokedCallables(node, checker, projectFiles)) {
        enterInvoked(callee, route, provided);
        followBindings(
          callee,
          argumentBindings(callee, node, NO_BINDINGS, checker, projectFiles),
          isInvokedWhereDefined(callee) ? route : hopped(route, callee, qualifyNames),
          provided,
        );
      }
    };
    const visit = (node: ts.Node, route: readonly string[], provided: ReadonlySet<string>): void => {
      // A nested callable carries its own requirements; merely creating it does
      // not execute its body. The production compiler records that callable's
      // row separately instead of contaminating the enclosing function.
      //
      // An IMMEDIATELY INVOKED callable is not merely created: it runs right
      // here, so its authority is this function's. The boundary that stops the
      // walk is INVOCATION, not definition — see `isInvokedWhereDefined` for the
      // callable written at the call, and `invokedCallables` for one reached
      // through a binding, a member, or another call's result.
      if (node !== fact.node.body && ts.isFunctionLike(node)) {
        if (entered.has(node)) return;
        if (!isInvokedWhereDefined(node)) return;
        entered.add(node);
      }
      const nodeFile = node.getSourceFile();
      if (node.kind === ts.SyntaxKind.AnyKeyword) charge("TypeScript", route, provided);
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        diagnostics.push(at(nodeFile, node, "SMITHERS3004", "type assertion portability is undecided; safe/reifiable/TypeScript-required classification needs checker proof", "warning"));
      }
      if (ts.isWithStatement(node)) {
        diagnostics.push(at(nodeFile, node, "SMITHERS3003", "with statements are forbidden in authored .sm code", "error"));
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) charge("TypeScript", route, provided);
        const capability = contextRequirement(node, checker, capabilityNaming);
        if (capability) charge(capability, route, provided);
        if (ts.isIdentifier(node.expression)) {
          if (
            (node.expression.text === "eval" || node.expression.text === "Function") &&
            isUnboundGlobal(node.expression)
          ) {
            charge("TypeScript", route, provided);
          }
          const directSymbol = checker.getSymbolAtLocation(node.expression);
          const calledSymbol = directSymbol && (directSymbol.flags & ts.SymbolFlags.Alias)
            ? checker.getAliasedSymbol(directSymbol)
            : directSymbol;
          const called = calledSymbol && factsBySymbol.get(calledSymbol);
          if (called) {
            fact.calls.push({ callee: called, node, provided });
          }
        }
        // Layer provision, recognized on the compiler-owned `Layer` symbol of
        // this analyzer's own prelude — never on a spelling, and never on a
        // second table of host knowledge about somebody's library.
        const provision = layerProvision(node, checker, capabilityNaming);
        if (provision) {
          const scope = provision.provides.size === 0
            ? provided
            : new Set([...provided, ...provision.provides]);
          for (
            const callback of flowCallables(provision.callback, NO_BINDINGS, checker, projectFiles, new Set())
          ) enterInvoked(callback, route, scope);
        }
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
        enterCall(node, route, provided);
      }
      if (ts.isPropertyAccessExpression(node)) {
        for (const accessor of invokedAccessors(node, checker, projectFiles)) {
          enterInvoked(accessor, route, provided);
        }
      }
      for (const ambientRequirement of requirementsForAmbientAuthority(node, checker, nodeFile)) {
        charge(ambientRequirement, route, provided);
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Function" &&
        isUnboundGlobal(node.expression)
      ) charge("TypeScript", route, provided);
      if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
        // The route continues past this function when the edge was laundered
        // through project re-exports, so the retained path names every
        // laundering module and ends at the foreign specifier — or, for
        // authority laundered through a module-level initializer, at the
        // binding and then the ambient expression it captured. One reference can
        // yield several requirements when an initializer captured more than one
        // root, so every edge it reaches is charged.
        for (const imported of requirementsForImportedReference(node, checker, projectFiles)) {
          charge(imported.requirement, [...route, ...imported.hops], provided);
        }
        if (hostGlobals.has(node.text) && isUnboundGlobal(node)) {
          charge(`Host<${JSON.stringify(node.text)}>`, route, provided);
        }
        if (undecidedGlobals.has(node.text) && isUnboundGlobal(node)) {
          diagnostics.push(at(nodeFile, node, "SMITHERS3002", `${node.text} portability is not classified yet`, "warning"));
        }
      }
      ts.forEachChild(node, (child) => visit(child, route, provided));
    };
    // A parameter default executes in this function when the argument is
    // omitted, so it is part of this function's row. Visiting only the body
    // lost it, and `function pinned(read = readFileSync) { return read("x") }`
    // was certified native with the `node:fs` edge written in plain sight.
    for (const parameter of fact.node.parameters) {
      if (parameter.initializer) visit(parameter.initializer, [fact.name], NOTHING_PROVIDED);
    }
    visit(fact.node.body!, [fact.name], NOTHING_PROVIDED);
  }

  // Set propagation with one retained dependency path per requirement.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts.values()) {
      for (const call of fact.calls) {
        const callee = call.callee;
        for (const [requirement, path] of callee.direct) {
          // Locked: providing a layer removes the matching capabilities from
          // the provided computation's row. A blocking requirement is never one
          // of them — see `charge`.
          if (call.provided.has(requirement) && !blocksNativePin(requirement)) continue;
          if (!fact.direct.has(requirement)) {
            fact.direct.set(requirement, [fact.name, ...path]);
            changed = true;
          }
        }
      }
    }
  }

  const functions: Record<string, FunctionCompatibility> = {};
  for (const fact of facts.values()) {
    const file = fact.node.getSourceFile();
    const requirementPaths = Object.fromEntries([...fact.direct].sort(([left], [right]) => compareText(left, right)));
    functions[fact.key] = {
      name: fact.name,
      requirements: Object.keys(requirementPaths),
      requirementPaths,
      nativePinned: fact.nativePinned,
    };
    if (fact.nativePinned) {
      // Only requirements that pin the code to a JavaScript host reject a
      // native pin. A nominal Context requirement (and the ambient `Clock` and
      // `Random` classifications) names a service the native target can
      // satisfy with its own layer, so it is reported in the row above with
      // its dependency path and never rejected here.
      //
      // The assertion is checked over the propagated row, which is the
      // complete transitive graph the fixpoint above computed, so a blocking
      // requirement reached through any number of hops is reported with every
      // hop of the path that introduced it.
      for (const [requirement, path] of Object.entries(requirementPaths)) {
        if (!blocksNativePin(requirement)) continue;
        diagnostics.push(at(
          fact.pin?.file ?? file,
          fact.pin?.node ?? fact.node,
          "SMITHERS3001",
          `native pin failed: ${requirement} is required through ${path.join(" -> ")}`,
          "error",
        ));
      }
    }
  }
  return { functions, diagnostics };
}

/**
 * The exported `native` of the compiler-owned prelude module, located by
 * walking this analyzer's own prelude declaration. Authority is therefore
 * CHECKER SYMBOL IDENTITY against a file no authored module can produce or
 * import from: the string `"native"` never appears in the recognition test for
 * user code. A locally declared `function native(...)`, or a `native` exported
 * by any installed package, resolves to a different symbol and pins nothing.
 */
function nativeIntrinsicSymbol(prelude: ts.SourceFile, checker: ts.TypeChecker): ts.Symbol {
  for (const statement of prelude.statements) {
    if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue;
    if (statement.name.text !== NATIVE_PIN_MODULE) continue;
    const body = statement.body;
    if (!body || !ts.isModuleBlock(body)) continue;
    for (const member of body.statements) {
      if (!ts.isFunctionDeclaration(member) || member.name?.text !== NATIVE_PIN_INTRINSIC) continue;
      const symbol = checker.getSymbolAtLocation(member.name);
      if (symbol) return symbol;
    }
  }
  // Failing closed here rather than returning `undefined` keeps a broken
  // prelude from quietly turning every native pin into a no-op assertion.
  throw new Error("compatibility analyzer could not resolve the native pin intrinsic");
}

/**
 * Apply every authored `native(...)` assertion to the function it names.
 *
 * The argument must resolve to a top-level function declaration of an analyzed
 * module. A pin whose subject the analyzer cannot identify is an assertion it
 * cannot check, so it is rejected rather than accepted — an unproven assertion
 * that compiles is exactly the fail-open shape the pin exists to prevent.
 */
function collectNativePins(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  prelude: ts.SourceFile,
  factsBySymbol: ReadonlyMap<ts.Symbol, Facts>,
  diagnostics: PortabilityDiagnostic[],
): void {
  const intrinsic = nativeIntrinsicSymbol(prelude, checker);
  const reject = (file: ts.SourceFile, node: ts.Node, detail: string): void => {
    diagnostics.push(at(
      file,
      node,
      "SMITHERS3005",
      `native pin is not checkable: ${detail}; ${NATIVE_PIN_INTRINSIC}(...) takes one reference to a function declared in this project`,
      "error",
    ));
  };
  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && unalias(checker.getSymbolAtLocation(node.expression), checker) === intrinsic) {
        const argument = node.arguments.length === 1 ? node.arguments[0] : undefined;
        if (!argument) {
          reject(file, node, `the pin was given ${node.arguments.length} arguments`);
        } else {
          const subject = unalias(checker.getSymbolAtLocation(argument), checker);
          const target = subject && factsBySymbol.get(subject);
          if (!target) reject(file, argument, "its argument does not resolve to an analyzed function declaration");
          else if (!target.nativePinned) {
            target.nativePinned = true;
            target.pin = { file, node };
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
}

/**
 * A native pin is a checked assertion over the complete transitive graph. The
 * specification makes the built-in `TypeScript` requirement the one a pin MUST
 * reject; `Module<...>` and `Host<...>` are the POC's concrete spellings of the
 * same JavaScript-host dependence.
 */
function blocksNativePin(requirement: string): boolean {
  return requirement === "TypeScript" || requirement.startsWith("Module<") ||
    requirement.startsWith("Host<");
}

function collectRuntimeImports(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): RuntimeImports {
  const sideEffects = new Map<string, readonly string[]>();
  collectLoadGraph(file, [], new Set(), sideEffects, checker, projectFiles);
  return { sideEffects };
}

/**
 * The module LOAD graph: what evaluating a module unconditionally evaluates.
 *
 * A side-effect import has no bindings to elide, so the module it names is
 * evaluated whenever the importing module is — and so is everything THAT module
 * side-effect imports, transitively. Until this walked the chain, only the first
 * link was charged: `import "./a.sm"` where `a.sm` runs `import "node:fs"`
 * charged nobody, and a function in `main.sm` was certified native-portable
 * although running it loads `node:fs`. That is the fail-open direction against a
 * Locked rule — "A native pin MUST be a checked assertion over the COMPLETE
 * TRANSITIVE GRAPH. Compilation MUST fail if any reachable operation or provider
 * requires `TypeScript`" (`specification/compatibility.mdx`, Native Pin).
 *
 * This makes an existing rule transitive; it does not invent a second
 * attribution rule. A BOUND import is still classified at each value use, where
 * `requirementsForImportedReference` answers it precisely, because an unread
 * binding's edge is elidable — the analyzer has always said so for a file's own
 * imports (`import { readFileSync } from "node:fs"` charges only the functions
 * that read it), and saying something stricter about another module's unread
 * binding than about your own would be incoherent in the opposite direction.
 * Reading such a binding DOES evaluate its module, and that is charged too:
 * `recordModuleLoad` applies this same function at every project module the
 * binding walk crosses.
 *
 * TERMINATION. `onStack` is a stack, not a memo — an entry is removed when its
 * branch finishes — matching the discipline the binding walk uses. A two-module
 * cycle stops when the chain re-enters a module it is already inside, and the
 * outer frame is still enumerating that module's remaining edges, so a foreign
 * edge behind a cycle is charged rather than swallowed.
 */
function collectLoadGraph(
  file: ts.SourceFile,
  route: readonly string[],
  onStack: Set<string>,
  into: Map<string, readonly string[]>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): void {
  const key = resolve(file.fileName);
  if (onStack.has(key)) return;
  onStack.add(key);
  try {
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      // Bound imports are classified through checker symbols at each value use,
      // where `requirementsForImportedReference` also recognizes the
      // compile-time asset edge and the compiler-owned edge.
      if (statement.importClause) continue;
      const specifier = statement.moduleSpecifier;
      if (isProjectModule(specifier, checker, projectFiles)) {
        const target = projectModuleFile(specifier, checker, projectFiles);
        if (target === undefined) continue;
        collectLoadGraph(
          target,
          [...route, portableFileName(target.fileName)],
          onStack,
          into,
          checker,
          projectFiles,
        );
        continue;
      }
      // Deliberately not exempted for import attributes: an asset import
      // requires runtime bindings, so a side-effect-only import is an ordinary
      // runtime module edge whatever it is attributed with (SMITHERS5208).
      const requirement = requirementForModule(specifier.text);
      if (requirement === undefined) continue;
      if (!into.has(requirement)) into.set(requirement, route.length === 0 ? [] : [...route, specifier.text]);
    }
  } finally {
    onStack.delete(key);
  }
}

/**
 * One foreign module edge reached from a value reference, with the route the
 * analyzer had to walk to reach it.
 *
 * `hops` is EMPTY when the referencing module imports the foreign module
 * itself, which keeps the retained dependency path of a direct import exactly
 * what it has always been: the requirement name (`Module<"node:fs">`) and the
 * diagnostic's own location already say where to look. When the edge was
 * LAUNDERED through one or more project modules, `hops` names each laundering
 * module in order and ends at the foreign specifier, because otherwise a
 * SMITHERS3001 path stops at the pinned function and a reader has no way to
 * find which of the project's modules actually introduced the requirement.
 */
interface ForeignEdge {
  readonly requirement: string;
  readonly hops: readonly string[];
}

/**
 * Chain state for one reference's walk. Both sets are STACKS — an entry is
 * removed when its branch finishes — so they detect a cycle on the current
 * chain without memoizing "clean" for a symbol whose answer depends on which
 * member of it is read.
 *
 * `ambient` is the second answer channel. The module-edge search short-circuits
 * on the first foreign specifier it reaches, because one blocking module edge
 * already decides the pin; ambient authority cannot use that shape, because a
 * single initializer can capture several roots with different requirements and
 * only some of them block (`Clock` does not, `Host<"process">` does). Dropping
 * the second root would grant a pin an initializer forbids, so ambient findings
 * ACCUMULATE — requirement to route, first route retained, mirroring
 * `addRequirement`.
 */
interface LaunderWalk {
  readonly checker: ts.TypeChecker;
  readonly projectFiles: ReadonlySet<string>;
  readonly symbols: Set<ts.Symbol>;
  readonly starLookups: Set<string>;
  readonly ambient: Map<string, readonly string[]>;
  /**
   * The file the reference was written in. Its own load graph is charged by
   * `collectRuntimeImports` with the route every existing assertion was measured
   * against, so `recordModuleLoad` never charges it a second time.
   */
  readonly origin: ts.SourceFile;
  /** The third answer channel: what evaluating a crossed module loads. */
  readonly loaded: Map<string, readonly string[]>;
  /**
   * Callables already entered on this reference's behalf. Monotone, because a
   * callable contributes the same requirements however it was reached and
   * `addRequirement` keeps the first route regardless; that makes it a
   * termination proof for recursive and mutually recursive callables as well as
   * a guard against re-walking one.
   */
  readonly entered: Set<ts.Node>;
  /**
   * The `(callee, callables bound to its parameters)` pairs already followed on
   * this reference's behalf — the argument half of value flow, keyed exactly as
   * the analyzed body walk keys it.
   *
   * It is a SECOND set rather than a re-keying of `entered`, and that is
   * load-bearing in both directions. `entered` stays keyed by the callable NODE,
   * because a callable contributes the same requirements however it was reached
   * and re-entering one could only re-derive the routes C50 and C53 asserted.
   * This set carries the part that IS binding-sensitive, so two call sites
   * handing one callee two different callables are followed separately —
   * dropping the second is the fail-open direction. Both components come from the
   * program's own syntax nodes, so the key space is finite and the monotone set
   * terminates recursion, mutual recursion, a self-referential binding and the
   * load-graph and binding cycles this walk crosses on top of them.
   */
  readonly followed: Set<string>;
}

/**
 * The requirement contributed by reading an imported binding, following the
 * binding to the module that actually owns it.
 *
 * A native pin is a CERTIFICATION that a function needs no TypeScript/Node
 * runtime, checked over the complete transitive graph. This walk stopped at the
 * first import declaration and treated every project-module specifier as
 * requirement-free, so any project module could launder a foreign edge —
 * `export { readFileSync } from "node:fs"` — and the pin was granted with no
 * `SMITHERS3001` while the direct import of the same function refused it. That
 * is the fail-open direction: it silently grants a certification the
 * specification forbids ("Compilation MUST fail if any reachable operation or
 * provider requires TypeScript", `specification/compatibility.mdx`, Locked).
 *
 * The walk now follows a binding across module boundaries until it reaches
 * something that is not a re-binding: a foreign specifier (charged), a
 * compile-time asset or compiler-owned edge (requirement-free), a type-only
 * edge (requirement-free — Locked: "A type-only import MUST NOT add that
 * requirement"), or an ordinary project declaration such as a function, whose
 * own requirements belong to the call graph and are propagated by the fixpoint
 * rather than by the reference.
 *
 * The SAME walk answers the second laundering shape: a binding whose module-level
 * initializer captured AMBIENT authority. `export const pid = process.pid` is a
 * host global published through a plain-looking constant, and reading a constant
 * looks pure, so a function reading `pid` was certified native-portable while the
 * identical `process.pid` written in its own body is charged `Host<"process">`.
 * That is the same fail-open class — authority laundered through a binding — and
 * the Locked rules decide it in both directions: "Platform-specific globals such
 * as `process` … MUST NOT be unconditional globals in authored `.sm` code"
 * and "Portability MUST be determined from the satisfied dependency closure, not
 * merely the source module's import path" (`specification/requirements.mdx`,
 * Platform Requirements). The initializer runs when the module loads, so its
 * authority is a real dependency of every reader of its result, exactly as a
 * module-level call into a foreign import already was.
 *
 * The ambient classification is the analyzer's existing one
 * (`requirementsForAmbientAuthority` plus `hostGlobals`), applied at the
 * initializer instead of being reimplemented, so `Date.parse`/`Date.UTC` stay
 * exempt and a lexical shadow stays ordinary for free.
 */
function requirementsForImportedReference(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): readonly ForeignEdge[] {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return [];
  const walk: LaunderWalk = {
    checker,
    projectFiles,
    symbols: new Set(),
    starLookups: new Set(),
    ambient: new Map(),
    origin: node.getSourceFile(),
    loaded: new Map(),
    entered: new Set(),
    followed: new Set(),
  };
  const edge = foreignEdgeForSymbol(symbol, memberRead(node), [], walk);
  // The module edge is first so that when a requirement name is reachable both
  // ways the module route — the older, asserted one — is the retained path.
  const edges: ForeignEdge[] = edge ? [edge] : [];
  for (const [requirement, hops] of walk.ambient) edges.push({ requirement, hops });
  for (const [requirement, hops] of walk.loaded) edges.push({ requirement, hops });
  return edges;
}

/**
 * The LOAD graph of a project module the walk crossed, charged to whoever made
 * it cross.
 *
 * Reading a binding declared in another project module evaluates that module,
 * and evaluating it evaluates everything it side-effect imports. Charging it
 * here rather than at the import declaration is what keeps the rule
 * NAME-DIRECTED, the precision C41 asserted and C40 spent a lane restoring: a
 * module that re-exports `node:fs` does not become foreign wholesale, because a
 * re-export publishes an elidable binding rather than evaluating anything the
 * reader did not ask for. What a module's evaluation does UNCONDITIONALLY is
 * exactly its side-effect imports, and that is what `collectLoadGraph` reads.
 */
function recordModuleLoad(file: ts.SourceFile, hops: readonly string[], walk: LaunderWalk): void {
  if (file === walk.origin || !walk.projectFiles.has(resolve(file.fileName))) return;
  const name = portableFileName(file.fileName);
  const route = hops[hops.length - 1] === name ? hops : [...hops, name];
  collectLoadGraph(file, route, new Set(), walk.loaded, walk.checker, walk.projectFiles);
}

/**
 * The member being read off a reference, when it is statically known. A
 * namespace binding for a project module is only as foreign as the export
 * actually read, so `laundry.readFileSync` charges while `laundry.safe` does
 * not. An unknown member (a dynamic element access, or the whole namespace
 * escaping into a value) yields `undefined` and is answered conservatively.
 */
function memberRead(node: ts.Identifier): string | undefined {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text;
  if (ts.isElementAccessExpression(parent) && parent.expression === node &&
    ts.isStringLiteralLike(parent.argumentExpression)) return parent.argumentExpression.text;
  return undefined;
}

function foreignEdgeForSymbol(
  symbol: ts.Symbol,
  member: string | undefined,
  hops: readonly string[],
  walk: LaunderWalk,
): ForeignEdge | undefined {
  if (walk.symbols.has(symbol)) return undefined;
  walk.symbols.add(symbol);
  try {
    for (const declaration of symbol.declarations ?? []) {
      // Reaching a declaration means the module that owns it is evaluated.
      recordModuleLoad(declaration.getSourceFile(), hops, walk);
      const edge = foreignEdgeForDeclaration(declaration, symbol, member, hops, walk);
      if (edge) return edge;
    }
    return undefined;
  } finally {
    walk.symbols.delete(symbol);
  }
}

function foreignEdgeForDeclaration(
  declaration: ts.Declaration,
  symbol: ts.Symbol,
  member: string | undefined,
  hops: readonly string[],
  walk: LaunderWalk,
): ForeignEdge | undefined {
  const { checker, projectFiles } = walk;
  const owner = aliasOwner(declaration);
  if (owner) {
    // Locked: a type-only edge adds no runtime requirement, in either the
    // import or the re-export spelling. This must not be over-corrected into a
    // requirement by the walk below.
    if (isTypeOnlyBinding(declaration, owner)) return undefined;
    const specifier = owner.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) {
      // `export { local }` re-exports a binding of this same module: no module
      // boundary is crossed, so the route gains no hop.
      const local = checker.getImmediateAliasedSymbol(symbol);
      return local ? foreignEdgeForSymbol(local, member, hops, walk) : undefined;
    }
    if (isProjectModule(specifier, checker, projectFiles)) {
      const target = projectModuleFile(specifier, checker, projectFiles);
      const route = [...hops, portableFileName((target ?? declaration.getSourceFile()).fileName)];
      const aliased = checker.getImmediateAliasedSymbol(symbol);
      // The checker collapses a star re-export, resolving straight to the
      // module that declares the name. Naming that module too keeps the route
      // complete rather than skipping the hop the author has to look at.
      if (aliased) return foreignEdgeForSymbol(aliased, member, extendRoute(route, aliased, walk), walk);
      // `export * from` publishes no per-name declaration to alias into, so the
      // name is resolved against the target module's star edges instead.
      return target === undefined
        ? undefined
        : foreignEdgeThroughStarExports(target, boundExportName(declaration) ?? member, route, walk);
    }
    if (isCompileTimeAssetEdge(owner)) return undefined;
    const requirement = requirementForModule(specifier.text);
    if (requirement === undefined) return undefined;
    return { requirement, hops: hops.length === 0 ? [] : [...hops, specifier.text] };
  }
  // A namespace binding resolves to the module itself.
  if (ts.isSourceFile(declaration)) {
    if (!projectFiles.has(resolve(declaration.fileName))) return undefined;
    for (const exported of checker.getExportsOfModule(symbol)) {
      if (member !== undefined && exported.getName() !== member) continue;
      const edge = foreignEdgeForSymbol(exported, undefined, hops, walk);
      if (edge) return edge;
    }
    return foreignEdgeThroughStarExports(declaration, member, hops, walk);
  }
  // A value binding is the other laundering shape: `import * as fs from
  // "node:fs"; export const read = fs.readFileSync` publishes a foreign
  // function through an ordinary `const`, and the binding's declaration names
  // no module at all. The initializer is the edge — and it is also where a
  // module-level `const` can capture ambient authority, which is why the
  // ambient route is anchored at THIS binding.
  const initializer = launderedInitializer(declaration);
  return initializer
    ? foreignEdgeInExpression(initializer, hops, bindingRoute(declaration, hops), walk)
    : undefined;
}

/** The import or export declaration a re-binding declaration belongs to. */
function aliasOwner(declaration: ts.Declaration): ts.ImportDeclaration | ts.ExportDeclaration | undefined {
  if (!ts.isImportClause(declaration) && !ts.isNamespaceImport(declaration) &&
    !ts.isImportSpecifier(declaration) && !ts.isExportSpecifier(declaration) &&
    !ts.isNamespaceExport(declaration)) return undefined;
  for (let current: ts.Node | undefined = declaration; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return current;
    if (ts.isSourceFile(current)) return undefined;
  }
  return undefined;
}

function isTypeOnlyBinding(
  declaration: ts.Declaration,
  owner: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean {
  if (ts.isImportDeclaration(owner)) {
    return Boolean(owner.importClause?.isTypeOnly) ||
      (ts.isImportSpecifier(declaration) && declaration.isTypeOnly);
  }
  return owner.isTypeOnly || (ts.isExportSpecifier(declaration) && declaration.isTypeOnly);
}

/** The name a re-binding declaration asks its target module for. */
function boundExportName(declaration: ts.Declaration): string | undefined {
  if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)) {
    return (declaration.propertyName ?? declaration.name).text;
  }
  if (ts.isImportClause(declaration)) return "default";
  return undefined;
}

/**
 * A name published by `export * from`. The checker has no alias to follow when
 * the star's target does not resolve — which is exactly the hostile case, since
 * no `node:` module resolves inside this analyzer's virtual project — so the
 * star edges are read from the target module's own syntax.
 *
 * Reached only when the name resolved to no declaration in the target module,
 * so a module that declares the name itself never consults its stars.
 */
function foreignEdgeThroughStarExports(
  file: ts.SourceFile,
  name: string | undefined,
  hops: readonly string[],
  walk: LaunderWalk,
): ForeignEdge | undefined {
  const key = `${file.fileName}#${name ?? "*"}`;
  if (walk.starLookups.has(key)) return undefined;
  walk.starLookups.add(key);
  try {
    for (const statement of file.statements) {
      if (!ts.isExportDeclaration(statement) || statement.exportClause !== undefined) continue;
      if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      if (isProjectModule(specifier, walk.checker, walk.projectFiles)) {
        const target = projectModuleFile(specifier, walk.checker, walk.projectFiles);
        if (target === undefined) continue;
        const edge = foreignEdgeThroughStarExports(
          target,
          name,
          [...hops, portableFileName(target.fileName)],
          walk,
        );
        if (edge) return edge;
        continue;
      }
      // `export * from` an asset is refused by the source-asset stage
      // (SMITHERS5206), so this edge is never a compile-time one.
      const requirement = requirementForModule(specifier.text);
      if (requirement !== undefined) return { requirement, hops: [...hops, specifier.text] };
    }
    return undefined;
  } finally {
    walk.starLookups.delete(key);
  }
}

/** The expression a non-alias binding takes its value from. */
function launderedInitializer(declaration: ts.Declaration): ts.Expression | undefined {
  if (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) return declaration.initializer;
  if (ts.isExportAssignment(declaration)) return declaration.expression;
  if (ts.isBindingElement(declaration)) {
    for (let current: ts.Node | undefined = declaration; current; current = current.parent) {
      if (ts.isVariableDeclaration(current) || ts.isParameter(current)) return current.initializer;
      if (ts.isSourceFile(current)) return undefined;
    }
  }
  return undefined;
}

/**
 * The first foreign edge any value reference in an expression reaches, and
 * EVERY ambient authority it captures.
 *
 * The module-edge search still stops at the first edge it finds: one blocking
 * module edge already decides the pin, and stopping is the behaviour every
 * existing route assertion was measured against. The ambient scan deliberately
 * does not stop, because `{ at: Date.now(), pid: process.pid }` must charge the
 * blocking `Host<"process">` even though the non-blocking `Clock` is reached
 * first — keeping the first hit there would grant the pin the initializer
 * forbids. Traversal is therefore complete for ambient and short-circuited for
 * module edges, which is why `found` guards the symbol walk rather than the
 * whole visit.
 *
 * The ambient scan does NOT enter a DEFERRED callable, because BUILDING a
 * closure does not run it: `const deferred = () => window.location` must stay
 * ordinary for the function that merely returns `deferred`, which is the same
 * rule the analyzed function body applies and an existing assertion pins. It
 * DOES enter an immediately invoked one, because that callable runs while the
 * initializer runs — `export const pid = (() => process.pid)()` is the same
 * host read as `export const pid = process.pid`, and hid behind precisely this
 * boundary. `isInvokedWhereDefined` draws the line at invocation rather than at
 * definition, and `deferred` is sticky: an IIFE written INSIDE a closure still
 * runs only when that closure is called, so it stays deferred.
 *
 * That boundary is deliberately not imposed on the module-edge search above,
 * whose behaviour for a DEFERRED callable predates this and is left
 * byte-identical; a module edge found inside a closure over-reports, which only
 * ever makes a pin harder to obtain. `keep(() => readFileSync("x"))` and a plain
 * `export const value = () => readFileSync("x")` both still charge, with their
 * original routes, and both are measured.
 *
 * It also ENTERS a callable the initializer CALLS, because a module initializer
 * has no call graph to defer to: nothing propagates a callee's row to a
 * module-level statement, so `export const value = helper()` charged nothing
 * while `export const value = process.pid` charged `Host<"process">`. The callee
 * is the one `invokedCallables` resolves, so the same rule decides it here and in
 * the analyzed body walk, and both routes gain the hop the reader has to look
 * at. `walk.entered` makes that terminate on a recursive or mutually recursive
 * chain.
 *
 * And `follow` applies the ARGUMENT half of value flow, which is what closed
 * `export const value = run(() => process.pid)`. One consequence is worth
 * naming, because it LENGTHENS one route rather than leaving it alone: when the
 * callee lives in another module, the callable it invokes is now reached as an
 * entered callee, so a module edge inside it is charged through the real
 * evaluation chain — `config.sm -> runner.sm -> config.sm -> node:fs` where the
 * deferred scan used to say `config.sm -> node:fs`. Both name the import to
 * delete; the longer one is the path the program actually takes, and it is
 * produced by `enter`'s existing hop rule rather than by a rule of its own.
 */
function foreignEdgeInExpression(
  expression: ts.Expression,
  hops: readonly string[],
  ambientRoute: readonly string[],
  walk: LaunderWalk,
): ForeignEdge | undefined {
  let found: ForeignEdge | undefined;
  /** The module chain a callee's own body is reached through. */
  const calleeHops = (callable: ts.FunctionLikeDeclaration, hops: readonly string[]): readonly string[] => {
    const file = portableFileName(callable.getSourceFile().fileName);
    return hops[hops.length - 1] === file ? hops : [...hops, file];
  };
  /** The ambient route through a callee, with the hop the reader has to look at. */
  const calleeRoute = (
    callable: ts.FunctionLikeDeclaration,
    ambientRoute: readonly string[],
  ): readonly string[] => {
    const name = callableName(callable);
    return name === undefined
      ? ambientRoute
      : [...ambientRoute, `${portableFileName(callable.getSourceFile().fileName)}#${name}`];
  };
  const enter = (
    callable: ts.FunctionLikeDeclaration | undefined,
    hops: readonly string[],
    ambientRoute: readonly string[],
  ): void => {
    // As in the body walk: a callable written AT the call is walked where it
    // stands, with the route it stands in, so it gains no hop of its own.
    if (callable === undefined || walk.entered.has(callable) || isInvokedWhereDefined(callable)) return;
    walk.entered.add(callable);
    // A module initializer has no call graph to defer to — nothing propagates a
    // callee's row to a module-level statement — so the callee is entered here,
    // including a top-level function declaration that IS an analyzed fact
    // elsewhere. Both routes gain the hop the reader has to look at.
    ts.forEachChild(callable, (child) =>
      visit(child, false, calleeHops(callable, hops), calleeRoute(callable, ambientRoute)));
  };
  /**
   * VALUE FLOW, argument half: the callables that reached a callee's parameters,
   * entered where that callee's own visible body actually invokes them.
   *
   * This is the SAME rule the analyzed body walk applies, applied here, not a
   * second rule for module level: enter the callee's visible body and charge only
   * what that body invokes. `run(cb)` charges because `run`'s body calls `cb()`;
   * `keep(cb)` does not because `keep`'s body only returns it; `[1].map(cb)`
   * stays undecidable because `lib.d.ts` has no body to read. No rule about
   * ARGUMENTS is added and no host knowledge about `Array.prototype` is
   * consulted — a rule about arguments would charge the mandated negative and
   * its identical twin alike, which is how this file has previously shipped an
   * over-correction.
   *
   * Only a callable the bindings resolve DIFFERENTLY from the ordinary
   * resolution is entered here. Whatever the callee's body does on its own
   * `enter` already walked, so this adds exactly the argument's contribution and
   * never a second copy of the callee's — which is why no route this walk already
   * produced moves.
   *
   * TERMINATION, and why `walk.entered` is NOT the set that carries this.
   * `walk.entered` is keyed by the callable NODE and stays that way: entering a
   * callable twice can only re-derive what it already contributed, and a second
   * entry would be a re-derivation of the routes C50 and C53 asserted. The
   * binding-sensitive part is this walk, so `walk.followed` is the set that is
   * keyed by the callee AND the callables bound to its parameters. Both come from
   * a FINITE set — the program's own syntax nodes — so the key space is finite
   * and the monotone set terminates every recursive, mutually recursive and
   * cyclic chain, including the ones the load graph and a binding cycle add on
   * top. The pair, not the callee alone: two call sites can hand one callee two
   * different callables, and dropping the second is the fail-open direction.
   */
  const follow = (
    callee: ts.FunctionLikeDeclaration,
    bindings: ReadonlyMap<ts.Symbol, FlowValue>,
    hops: readonly string[],
    ambientRoute: readonly string[],
  ): void => {
    if (bindings.size === 0) return;
    const key = bindingsKey(callee, bindings);
    if (walk.followed.has(key)) return;
    walk.followed.add(key);
    const step = (node: ts.Node): void => {
      // BUILDING a callable is not running it, here as everywhere else: a callee
      // that wraps its parameter in a closure it returns has not invoked it.
      if (ts.isFunctionLike(node) && !isInvokedWhereDefined(node)) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
        const ordinary = invokedCallables(node, walk.checker, walk.projectFiles);
        const flowed = invokedCallables(node, walk.checker, walk.projectFiles, bindings);
        for (const target of flowed) {
          if (!ordinary.includes(target)) enter(target, hops, ambientRoute);
        }
        for (const target of flowed.length === 0 ? ordinary : flowed) {
          // The next callee's bindings are recomputed in THIS environment, so a
          // callable handed on through a second visible function is followed too.
          follow(
            target,
            argumentBindings(target, node, bindings, walk.checker, walk.projectFiles),
            isInvokedWhereDefined(target) ? hops : calleeHops(target, hops),
            isInvokedWhereDefined(target) ? ambientRoute : calleeRoute(target, ambientRoute),
          );
        }
      }
      // A property READ runs a getter, and which getter it runs is the same
      // value question a call asks — asked here for the same reason and by the
      // same resolver as in the analyzed body walk.
      if (ts.isPropertyAccessExpression(node)) {
        const ordinary = invokedAccessors(node, walk.checker, walk.projectFiles);
        for (const accessor of invokedAccessors(node, walk.checker, walk.projectFiles, bindings)) {
          if (!ordinary.includes(accessor)) enter(accessor, hops, ambientRoute);
        }
      }
      ts.forEachChild(node, step);
    };
    ts.forEachChild(callee, step);
  };
  const enterCall = (
    node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
    hops: readonly string[],
    ambientRoute: readonly string[],
  ): void => {
    for (const callee of invokedCallables(node, walk.checker, walk.projectFiles)) {
      enter(callee, hops, ambientRoute);
      follow(
        callee,
        argumentBindings(callee, node, NO_BINDINGS, walk.checker, walk.projectFiles),
        isInvokedWhereDefined(callee) ? hops : calleeHops(callee, hops),
        isInvokedWhereDefined(callee) ? ambientRoute : calleeRoute(callee, ambientRoute),
      );
    }
  };
  const visit = (
    node: ts.Node,
    deferred: boolean,
    hops: readonly string[],
    ambientRoute: readonly string[],
  ): void => {
    // Already entered as an invoked callee, with its own route; walking it a
    // second time can only re-derive what it already contributed.
    if (ts.isFunctionLike(node) && walk.entered.has(node)) return;
    if (!deferred) recordAmbientAuthority(node, ambientRoute, walk);
    if (!found && ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
      const symbol = walk.checker.getSymbolAtLocation(node);
      if (symbol) found = foreignEdgeForSymbol(symbol, memberRead(node), hops, walk);
    }
    if (!deferred) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) {
        enterCall(node, hops, ambientRoute);
      }
      // A module-level `Layer.provide` runs its callback when the module loads,
      // exactly as an initializer's ordinary call does. No subtraction is
      // possible here and none is needed: this walk's two channels carry module
      // edges and ambient authority, and a layer provides nominal capabilities,
      // which are neither.
      if (ts.isCallExpression(node)) {
        const provision = layerProvideCallback(node, walk.checker);
        if (provision) {
          for (
            const callback of flowCallables(provision, NO_BINDINGS, walk.checker, walk.projectFiles, new Set())
          ) enter(callback, hops, ambientRoute);
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        for (const accessor of invokedAccessors(node, walk.checker, walk.projectFiles)) {
          enter(accessor, hops, ambientRoute);
        }
      }
    }
    const nested = deferred || (ts.isFunctionLike(node) && !isInvokedWhereDefined(node));
    ts.forEachChild(node, (child) => visit(child, nested, hops, ambientRoute));
  };
  visit(expression, false, hops, ambientRoute);
  return found;
}

/**
 * A callable that is INVOKED at the point it is defined, so its body really
 * runs where it is written.
 *
 * This is the whole of the closure rule's second half, and both walks share it
 * so they cannot drift. DEFINING a callable that would touch ambient authority
 * is not a use of that authority: `const deferred = () => window.location` must
 * stay ordinary, and an assertion pins it. An immediately invoked callable
 * hides behind exactly that boundary because it is defined and invoked at once,
 * so `(() => process.pid)()` charged nothing while the identical `process.pid`
 * written directly charged `Host<"process">`.
 *
 * The test is answered from SYNTAX AT THE DEFINITION SITE, never by descending
 * into nested callables to see what they touch — descending is the
 * over-correction a previous attempt at this shipped, and it is what broke the
 * `deferred` assertion. The callable must BE the callee: `(fn)()`, `fn?.()`,
 * `new (fn)()`, a tagged template's tag, `fn.call(...)`/`fn.apply(...)`, and
 * `fn.bind(...)()` where the bound result is itself invoked in turn.
 * Parentheses and type-only wrappers are transparent, because an IIFE is nearly
 * always written inside parentheses.
 *
 * A callable in an ARGUMENT position is deliberately NOT invoked here.
 * `keep(() => process.pid)` and `list.map(() => process.pid)` hand a callable to
 * a function whose body this analyzer does not model; whether it is ever called
 * is that callee's business. `invokedCallables` decides that half by asking which
 * signature the CALL selected — `keep`'s and `Array.prototype.map`'s, never the
 * argument — so the two identical shapes are separated from the callable written
 * at the call without any host knowledge about `Array.prototype`. Treating an
 * argument as invoked would charge `keep(...)`, and "a callable passed without
 * being invoked stays ordinary" is the negative direction this file has
 * repeatedly got wrong.
 */
function isInvokedWhereDefined(callable: ts.Node): boolean {
  let current: ts.Node = callable;
  let parent: ts.Node | undefined = current.parent;
  while (
    parent !== undefined &&
    (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) ||
      ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent))
  ) {
    current = parent;
    parent = current.parent;
  }
  if (parent === undefined) return false;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === current) return true;
  // A tagged template invokes its tag with the template's parts, and `?.()` is
  // still a call. Both are ordinary CallExpression/TaggedTemplateExpression
  // shapes rather than new rules.
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === current) return true;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== current) return false;
  const applied = parent.parent;
  if (applied === undefined || !ts.isCallExpression(applied) || applied.expression !== parent) return false;
  // `.call`/`.apply` run the receiver now. `.bind` only produces ANOTHER
  // callable, so the receiver runs only when that result is invoked in turn,
  // which is the same invocation question one level up.
  const method = parent.name.text;
  if (method === "call" || method === "apply") return true;
  return method === "bind" && isInvokedWhereDefined(applied);
}

/**
 * The callable a call actually runs, when the analyzer can see its body.
 *
 * `isInvokedWhereDefined` answers the callable written AT the call. This answers
 * the other half of the same question — a callable reached THROUGH something,
 * which is every remaining shape of the indirect/higher-order and method holes:
 * `const f = () => process.pid; f()`, `alias()`, `holder.read()`, `C.m()`,
 * `new C().m()`, `make()()`, and a module-level `helper()`. All of them run a
 * body this analyzer can see, and all of them charged nothing.
 *
 * Resolution is the CHECKER'S, not a second table: `getResolvedSignature`
 * returns the signature the call site actually selected, and the frontend
 * resolves a call the same way (`resolveLocalCallee` in
 * `src/language/semantic.ts` reads `checker.getResolvedSignature(call)
 * ?.declaration` first). Using the same question is what makes the two rows
 * agree by construction — the classifier's row for `alias()` and for
 * `holder.read()` was `[]` while the frontend's was `["Config"]`, and that
 * disagreement was recorded in this file's tests as a known gap.
 *
 * It also settles the ARGUMENT position without a rule of its own, which is what
 * `.map` needed. `[1].map(cb)` resolves to `Array.prototype.map`'s signature in
 * `lib.d.ts` — a declaration with no body, in no project file — so nothing is
 * entered, exactly as for `keep(cb)`, whose selected signature is `keep`'s. The
 * two identical shapes stay identical: neither charges its callback, and the
 * separation costs no host knowledge. `function run(cb: () => unknown) { return
 * cb() }` behaves the same way, because the signature `cb()` selects is declared
 * by the parameter's FUNCTION TYPE, which has no body either.
 *
 * A declaration file has no body to enter, so `Capability.context()` keeps being
 * classified by `contextRequirement` and `Layer.provide` by `layerProvision`,
 * both of which read the compiler-owned prelude's own symbols rather than
 * descending into a declaration that has no body.
 *
 * When the selected signature has NO visible body the callee is resolved by
 * VALUE FLOW instead (`flowCallables`): which literal an annotated binding holds,
 * which callable a parameter default names, which callable reached a parameter,
 * which method a class instance carries, which callables a factory returns, and
 * which element a positional list holds. That is a third question about the same
 * call, not a table of exceptions, and it leaves `[1].map(cb)` exactly where it
 * was — an array literal is a list, a list answers a lookup by INDEX and never
 * one by NAME, so an array literal holds no `map` of its own and nothing is
 * entered.
 *
 * It returns SEVERAL callables when the value question has several answers — a
 * factory with two returns, a conditional, an element of a list a `for…of`
 * iterates — and every one of them is entered, because any of them can be the
 * one that arrives. The CHECKER'S answer is never widened this way: it is one
 * declaration, it is the one the call site selected, and it is taken alone.
 */
function invokedCallables(
  call: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  bindings: ReadonlyMap<ts.Symbol, FlowValue> = NO_BINDINGS,
): readonly ts.FunctionLikeDeclaration[] {
  const selected = projectCallable(checker.getResolvedSignature(call)?.declaration, projectFiles) ??
    projectCallable(appliedReceiver(call, checker), projectFiles);
  // The checker's answer is ONE declaration and it is the one the call site
  // selected, so it is taken alone. Only when it has no body does the value
  // question run, and that one can have several answers.
  if (selected !== undefined) return [selected];
  return flowCallables(calleeTarget(call), bindings, checker, projectFiles, new Set());
}

/**
 * The expression whose VALUE is invoked by a call, for the value-flow fallback.
 * `f.call(...)`/`f.apply(...)` run the receiver, on the same reasoning
 * `appliedReceiver` states; `.bind` is absent there and here, because it
 * produces another callable rather than running one.
 */
function calleeTarget(
  call: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
): ts.Expression {
  const target = ts.isTaggedTemplateExpression(call) ? call.tag : call.expression;
  const inner = unwrapExpression(target);
  if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(inner) &&
    (inner.name.text === "call" || inner.name.text === "apply")) return inner.expression;
  return target;
}

/** Parentheses and type-only wrappers are transparent to every value question. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

/**
 * The value an expression holds, followed through bindings — the analysis the
 * callable boundary needed and did not have.
 *
 * A callable is not always the thing the checker SELECTED. `const holder:
 * Reader = { read() { … } }` selects the interface member, `(g = () => …) => g()`
 * selects the parameter's function type, and `run(cb)`'s `cb()` selects the
 * parameter's function type too — three spellings of one question: which literal
 * actually reaches this call. This answers it from the syntax that produced the
 * value: an object literal, a function literal, an initializer, or the argument
 * bound to a parameter.
 *
 * It follows initializers rather than assignments, which is the same evidence
 * the reassigned-`let` over-report already runs on: `let f = () => process.pid;
 * f = () => 1; f()` charges `Host<"process">` on purpose, because refusing a pin
 * the program might have earned is the safe direction.
 *
 * `seen` holds the symbols AND the callables already visited, so a
 * self-referential binding, a recursive factory and a class whose method returns
 * an instance of its own class all terminate.
 *
 * FIVE further spellings of the same question are answered here, each of which
 * charged nothing while a live host read ran, and each of which had an answer
 * the walk was simply not asking for:
 *
 *   `new Impl()`      — the CLASS is the value. A `new` expression is neither a
 *                       callable nor an object literal, but the class
 *                       declaration is visible and so is the method body a
 *                       callee reaches through it (`classMemberValue`).
 *   `make()`          — a CALL RESULT is the value its callee RETURNS.
 *                       `make`'s body is visible, so this is the ordinary
 *                       "enter the visible body" question asked about a return
 *                       rather than about a call.
 *   `[a, b]`          — an array literal is a POSITIONAL list, read back by
 *                       `fns[0]`. A member lookup by NAME on a list resolves to
 *                       nothing, so `[1].map(cb)` is exactly where it was.
 *   `{ cb }` in a parameter position — a DESTRUCTURED parameter, bound member by
 *                       member from the object literal the caller passed
 *                       (`bindPattern`), falling back to the element's own
 *                       default when the caller omitted the property.
 *   `...cbs`          — a REST parameter collects the remaining arguments into
 *                       the same positional list an array literal produces.
 *   `...[cb]`         — a SPREAD argument or element is FLATTENED into the list
 *                       it spreads (`positionalValues`); a spread whose source
 *                       is not a list still ends the mapping.
 *   `{ ...base }`     — an object SPREAD republishes what a spread copies: an
 *                       object literal's own members, and a class's own instance
 *                       properties but never its prototype methods.
 *   `n ? a : b`       — BOTH branches, as a union. So are all of a factory's
 *                       returns, and so are all the elements a `for…of` binds
 *                       its variable to in turn (`iteratedValue`).
 *
 * What still has no answer is named in the header: a call with no visible body
 * AND no literal anywhere (`[1].map(cb)`, `cbs.forEach(cb => cb())`, a host
 * `Map` or `Set`, an interface-typed `declare const`), an element read by a
 * NON-LITERAL index, a spread whose source is not a list, and a setter.
 */
function flowValue(
  expression: ts.Expression | undefined,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  if (expression === undefined) return undefined;
  const node = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return projectCallable(node, projectFiles);
  if (ts.isArrayLiteralExpression(node)) {
    return { values: positionalValues(node.elements, bindings, checker, projectFiles, seen).values };
  }
  // `new Impl()` holds an instance of a class whose body is visible. Only a
  // class is accepted: `new Date(0)` resolves to a declaration file and
  // `projectClass` refuses it, exactly as `projectCallable` refuses `lib.d.ts`.
  if (ts.isNewExpression(node)) {
    return flowUnion(
      flowOptions(flowValue(node.expression, bindings, checker, projectFiles, seen)).map(asClass),
    );
  }
  if (ts.isCallExpression(node)) return flowReturnValue(node, bindings, checker, projectFiles, seen);
  // Both branches of a conditional can arrive, and the analyzer does not decide
  // branches — the same reason a factory's several `return`s are all followed.
  if (ts.isConditionalExpression(node)) {
    return flowUnion([
      flowValue(node.whenTrue, bindings, checker, projectFiles, new Set(seen)),
      flowValue(node.whenFalse, bindings, checker, projectFiles, new Set(seen)),
    ]);
  }
  if (ts.isPropertyAccessExpression(node)) {
    return flowMember(node.expression, node.name.text, bindings, checker, projectFiles, seen);
  }
  // `fns[0]` reads a positional list by index; `holder["read"]` is the member
  // read `memberRead` already recognizes in its other spelling.
  if (ts.isElementAccessExpression(node)) {
    const argument = unwrapExpression(node.argumentExpression);
    if (ts.isStringLiteralLike(argument)) {
      return flowMember(node.expression, argument.text, bindings, checker, projectFiles, seen);
    }
    if (!ts.isNumericLiteral(argument)) return undefined;
    const index = Number(argument.text);
    const target = flowValue(node.expression, bindings, checker, projectFiles, seen);
    return flowUnion(flowOptions(target).map((option) => flowList(option)?.[index]));
  }
  if (!ts.isIdentifier(node)) return undefined;
  return flowValueOfSymbol(checker.getSymbolAtLocation(node), bindings, checker, projectFiles, seen);
}

/**
 * The values a POSITIONAL list of expressions contributes — an array literal's
 * elements, or a call's arguments — with a SPREAD flattened into the list it
 * spreads.
 *
 * `run(...[cb])` really passes `cb` in the first position; ECMAScript's spread
 * evaluation says so, and once an array literal is a positional list the
 * flattening is READ from that list rather than guessed at. It is positional and
 * not "charge every element": `run(...[a, b])` where the callee invokes only its
 * SECOND parameter charges `b` and not `a`, and that precision is asserted.
 *
 * A spread whose source does not resolve to a list contributes an UNKNOWN NUMBER
 * of values, so nothing after it has a position any more and the list ends
 * there. That is the same "ends the mapping rather than guessing" rule the
 * spread already had, narrowed to the case where the count is genuinely unknown.
 */
function positionalValues(
  elements: readonly ts.Expression[],
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): { readonly values: readonly (FlowValue | undefined)[]; readonly truncated: boolean } {
  const values: (FlowValue | undefined)[] = [];
  for (const element of elements) {
    if (ts.isOmittedExpression(element)) {
      values.push(undefined);
      continue;
    }
    if (ts.isSpreadElement(element)) {
      const list = flowList(flowValue(element.expression, bindings, checker, projectFiles, new Set(seen)));
      if (list === undefined) return { values, truncated: true };
      values.push(...list);
      continue;
    }
    values.push(flowValue(element, bindings, checker, projectFiles, new Set(seen)));
  }
  return { values, truncated: false };
}

/** A member READ from whatever value an expression holds, by name. */
function flowMember(
  target: ts.Expression,
  name: string,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const value = flowValue(target, bindings, checker, projectFiles, seen);
  return flowUnion(flowOptions(value).map((option) =>
    memberOfValue(option, name, bindings, checker, projectFiles, new Set(seen))));
}

/** One resolved value's member of a name, in an object literal or a class. */
function memberOfValue(
  value: FlowValue,
  name: string,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const literal = asObjectLiteral(value);
  if (literal !== undefined) return objectMemberValue(literal, name, bindings, checker, projectFiles, seen);
  const declaration = asClass(value);
  return declaration === undefined
    ? undefined
    : classMemberValue(declaration, name, bindings, checker, projectFiles, seen);
}

/**
 * The value a CALL RETURNS, when the callee's body is visible.
 *
 * This is not a new question, it is the existing one — enter the callee's
 * visible body — asked about a `return` instead of about a call. `function
 * make() { return () => process.pid }; run(make())` hands `run` a callable whose
 * body is right there, and it charged nothing.
 *
 * The callee's parameters are bound first, so an identity factory
 * (`function pick(cb) { return cb }`) is followed too.
 *
 * EVERY resolvable return is taken, and the result is their union. It used to be
 * the FIRST, which meant `function make(n) { if (n) { return () => 1 } return
 * () => process.pid }` charged nothing while `make`'s other return ran a live
 * host read — the same program with its two returns swapped was charged, which
 * is the shape that proves it was an accident of order rather than an answer.
 * Any of the returns can reach the call and this analyzer decides no branch, so
 * the union is what runs. `seen` carries each callee, so a recursive or mutually
 * recursive factory terminates.
 */
function flowReturnValue(
  call: ts.CallExpression,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const returned: (FlowValue | undefined)[] = [];
  for (const callee of invokedCallables(call, checker, projectFiles, bindings)) {
    if (seen.has(callee)) continue;
    seen.add(callee);
    const inner = argumentBindings(callee, call, bindings, checker, projectFiles);
    for (const expression of returnedExpressions(callee)) {
      returned.push(flowValue(expression, inner, checker, projectFiles, new Set(seen)));
    }
  }
  return flowUnion(returned);
}

/**
 * The expressions a callable RETURNS, from its own body only: a `return` inside
 * a nested callable or class member belongs to that callable, not to this one.
 */
function returnedExpressions(callee: ts.FunctionLikeDeclaration): ts.Expression[] {
  const body = callee.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const found: ts.Expression[] = [];
  const step = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression) found.push(node.expression);
      return;
    }
    ts.forEachChild(node, step);
  };
  ts.forEachChild(body, step);
  return found;
}

function flowValueOfSymbol(
  local: ts.Symbol | undefined,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  if (local === undefined) return undefined;
  const bound = bindings.get(local);
  if (bound !== undefined) return bound;
  const symbol = unalias(local, checker);
  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isFunctionLike(declaration)) {
      const callable = projectCallable(declaration, projectFiles);
      if (callable) return callable;
      continue;
    }
    if (ts.isClassLike(declaration)) {
      const declared = projectClass(declaration, projectFiles);
      if (declared) return declared;
      continue;
    }
    // A destructured binding holds the MEMBER it names, not the whole object it
    // was taken from. Falling through to `launderedInitializer` when that cannot
    // be resolved keeps the laundering answer this walk already had.
    if (ts.isBindingElement(declaration)) {
      const destructured = bindingElementValue(declaration, bindings, checker, projectFiles, seen);
      if (destructured) return destructured;
    }
    // `for (const cb of cbs)` has no initializer to launder; what it holds is an
    // element of the list it iterates.
    if (ts.isVariableDeclaration(declaration)) {
      const iterated = iteratedValue(declaration, bindings, checker, projectFiles, seen);
      if (iterated) return iterated;
    }
    const value = flowValue(launderedInitializer(declaration), bindings, checker, projectFiles, seen);
    if (value) return value;
  }
  return undefined;
}

/**
 * The value a `for (const cb of cbs)` binding holds: any element of the list it
 * iterates, so the UNION of all of them.
 *
 * Iterating a list runs the body for EVERY element, so the union is exactly what
 * runs rather than an over-report — and that is precisely what separates it from
 * an element read by an unknown INDEX, where one element runs and the analyzer
 * cannot say which. `cbs.forEach((cb) => cb())` is deliberately NOT this: the
 * body that would call the callback is `Array.prototype.forEach`'s, which is not
 * visible, so it stays exactly where `[1].map(cb)` is, for the same reason and
 * with no host knowledge about `Array.prototype` consulted.
 */
function iteratedValue(
  declaration: ts.VariableDeclaration,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const list = declaration.parent;
  if (list === undefined || !ts.isVariableDeclarationList(list)) return undefined;
  const statement = list.parent;
  if (statement === undefined || !ts.isForOfStatement(statement)) return undefined;
  const iterated = flowValue(statement.expression, bindings, checker, projectFiles, seen);
  return flowUnion(flowOptions(iterated).flatMap((option) => flowList(option) ?? []));
}

/** Every callable a value resolves to, in source order and de-duplicated. */
function flowCallables(
  expression: ts.Expression | undefined,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): readonly ts.FunctionLikeDeclaration[] {
  const found: ts.FunctionLikeDeclaration[] = [];
  for (const option of flowOptions(flowValue(expression, bindings, checker, projectFiles, seen))) {
    const callable = asCallable(option);
    if (callable !== undefined && !found.includes(callable)) found.push(callable);
  }
  return found;
}

/**
 * A member of an object literal. A getter is deliberately absent —
 * `invokedAccessors` owns the property READ, and only a read runs one.
 *
 * A SPREAD republishes what it spreads, so `{ ...base }` carries `base`'s
 * members and `run({ ...base })` reaches the body `base` declared. Properties
 * are scanned in SOURCE ORDER and the LAST match wins, which is ECMAScript's own
 * rule and is what makes `{ ...base, read() { … } }` resolve to the override and
 * `{ read() { … }, ...base }` resolve to what `base` published. A member of that
 * name that carries no followable value still SHADOWS an earlier one, because a
 * read of that name reaches it and not what the spread published.
 */
function objectMemberValue(
  literal: ts.ObjectLiteralExpression,
  name: string,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  let found: FlowValue | undefined;
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      const source = flowValue(property.expression, bindings, checker, projectFiles, new Set(seen));
      const member = spreadMemberValue(source, name, bindings, checker, projectFiles, new Set(seen));
      if (member !== undefined) found = member;
      continue;
    }
    if (!namedMember(property, name)) continue;
    found = ts.isMethodDeclaration(property)
      ? projectCallable(property, projectFiles)
      : ts.isPropertyAssignment(property)
      ? flowValue(property.initializer, bindings, checker, projectFiles, seen)
      // `{ read }` publishes whatever the binding holds. The shorthand's own
      // name resolves to the PROPERTY, so the value comes from the checker's
      // shorthand symbol, the same one `isAmbientReference` reads.
      : ts.isShorthandPropertyAssignment(property)
      ? flowValueOfSymbol(
        checker.getShorthandAssignmentValueSymbol(property),
        bindings,
        checker,
        projectFiles,
        seen,
      )
      : undefined;
  }
  return found;
}

/**
 * The member a SPREAD republishes, which is decided by what a spread actually
 * copies: OWN ENUMERABLE properties.
 *
 * An object literal's members are own properties, so `{ ...base }` carries them.
 * A class's METHODS live on its prototype and are NOT copied, so
 * `{ ...new Impl() }.read` is `undefined` at run time and claiming otherwise
 * would put a body in the route that the program never runs — the checker's own
 * spread type is wider than the language here, and this follows the language. A
 * class's own instance PROPERTY is copied, so it is republished.
 */
function spreadMemberValue(
  value: FlowValue | undefined,
  name: string,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const literal = asObjectLiteral(value);
  if (literal !== undefined) return objectMemberValue(literal, name, bindings, checker, projectFiles, seen);
  const declaration = asClass(value);
  return declaration === undefined
    ? undefined
    : classPropertyValue(declaration, name, bindings, checker, projectFiles, seen);
}

/** A class's own instance PROPERTY of a name, including an inherited one. */
function classPropertyValue(
  declaration: ts.ClassLikeDeclaration,
  name: string,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  if (seen.has(declaration)) return undefined;
  seen.add(declaration);
  for (const member of declaration.members) {
    if (!namedMember(member, name)) continue;
    return ts.isPropertyDeclaration(member)
      ? flowValue(member.initializer, bindings, checker, projectFiles, seen)
      : undefined;
  }
  const base = baseClass(declaration, bindings, checker, projectFiles, seen);
  return base === undefined
    ? undefined
    : classPropertyValue(base, name, bindings, checker, projectFiles, seen);
}

/**
 * A member of a CLASS, including one it inherits.
 *
 * This is `objectMemberValue`'s counterpart and it answers the same question for
 * the same reason: `run(new Impl())` where the callee calls `r.read()` selects
 * the INTERFACE member, which has no body, while `Impl`'s method body is right
 * there. An own member is looked at first, so an OVERRIDE wins over the base it
 * replaces and a clean override of a host-reading base stays clean.
 *
 * A get accessor ends the lookup rather than resolving, for the reason the
 * object-literal version omits one: `invokedAccessors` owns the property read,
 * and an own accessor shadows any base method of the same name.
 */
function classMemberValue(
  declaration: ts.ClassLikeDeclaration,
  name: string,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  if (seen.has(declaration)) return undefined;
  seen.add(declaration);
  for (const member of declaration.members) {
    const memberName = member.name;
    if (memberName === undefined || !(ts.isIdentifier(memberName) || ts.isStringLiteral(memberName))) continue;
    if (memberName.text !== name) continue;
    if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) return undefined;
    if (ts.isMethodDeclaration(member)) {
      // An overload signature has no body; the implementation that follows it
      // does, so the lookup continues rather than stopping at the signature.
      const callable = projectCallable(member, projectFiles);
      if (callable) return callable;
      continue;
    }
    if (ts.isPropertyDeclaration(member)) {
      const value = flowValue(member.initializer, bindings, checker, projectFiles, seen);
      if (value) return value;
      continue;
    }
  }
  const base = baseClass(declaration, bindings, checker, projectFiles, seen);
  return base === undefined ? undefined : classMemberValue(base, name, bindings, checker, projectFiles, seen);
}

/** The class a class extends, when that declaration is visible too. */
function baseClass(
  declaration: ts.ClassLikeDeclaration,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): ts.ClassLikeDeclaration | undefined {
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    const base = clause.types[0]?.expression;
    if (base === undefined) continue;
    for (const option of flowOptions(flowValue(base, bindings, checker, projectFiles, seen))) {
      const value = asClass(option);
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * The value a DESTRUCTURED binding holds: the member it names, or — when the
 * source cannot be resolved or does not carry that member — its own default.
 *
 * `function run({ cb }: { cb: () => unknown }) { return cb() }` reaches its
 * callable this way when the caller passed an object literal, and
 * `{ cb = () => process.pid }` reaches it this way when the caller omitted the
 * property, which are the two halves of one spelling.
 */
function bindingElementValue(
  element: ts.BindingElement,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const pattern = element.parent;
  const source = patternSource(pattern, bindings, checker, projectFiles, seen);
  if (source !== undefined) {
    const member = patternMember(element, pattern, source, bindings, checker, projectFiles, seen);
    if (member !== undefined) return member;
  }
  return flowValue(element.initializer, bindings, checker, projectFiles, seen);
}

/** The value a binding pattern destructures. */
function patternSource(
  pattern: ts.BindingPattern,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  const parent = pattern.parent;
  if (ts.isBindingElement(parent)) return bindingElementValue(parent, bindings, checker, projectFiles, seen);
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) {
    return flowValue(parent.initializer, bindings, checker, projectFiles, seen);
  }
  return undefined;
}

/** The member of a destructured value one binding element names. */
function patternMember(
  element: ts.BindingElement,
  pattern: ts.BindingPattern,
  source: FlowValue,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): FlowValue | undefined {
  if (element.dotDotDotToken) return undefined;
  if (ts.isArrayBindingPattern(pattern)) {
    const index = pattern.elements.indexOf(element);
    return flowUnion(flowOptions(source).map((option) => flowList(option)?.[index]));
  }
  const named = element.propertyName ?? element.name;
  if (!(ts.isIdentifier(named) || ts.isStringLiteral(named))) return undefined;
  return flowUnion(flowOptions(source).map((option) =>
    memberOfValue(option, named.text, bindings, checker, projectFiles, new Set(seen))));
}

/**
 * Which value reached which parameter, for one call. Positional, and now
 * complete for the two spellings that used to end the mapping:
 *
 * - a DESTRUCTURED parameter is bound member by member from the object literal
 *   the caller passed (`bindPattern`), leaving a member the caller omitted
 *   unbound so the element's own default answers for it;
 * - a REST parameter collects the remaining arguments into the positional list
 *   an array literal produces, so `cbs[0]` reads back what `run(cb)` passed.
 *
 * A SPREAD argument still ends the mapping, because nothing decides which value
 * lands where without knowing how many the spread contributes.
 *
 * A TAGGED TEMPLATE is mapped, and the mapping is READ rather than guessed:
 * ECMAScript evaluates ``tag`a${x}b${y}` `` as `tag(strings, x, y)`, so the
 * substitutions correspond to the parameters after the first, in source order.
 * That is the same correspondence the CHECKER uses to select the tag's
 * signature, and the same one `isInvokedWhereDefined` already relies on when it
 * treats a tag as invoked. `parameterOffset` is where that one-place shift
 * lives.
 */
function argumentBindings(
  callee: ts.FunctionLikeDeclaration,
  call: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): ReadonlyMap<ts.Symbol, FlowValue> {
  const next = new Map<ts.Symbol, FlowValue>();
  const tagged = ts.isTaggedTemplateExpression(call);
  const written = tagged ? templateSubstitutions(call) : [...(call.arguments ?? [])];
  const args = positionalValues(written, bindings, checker, projectFiles, new Set()).values;
  // The tag receives the strings array first, so its own parameters start one
  // place later than the values this maps.
  const offset = tagged ? 1 : 0;
  for (let index = 0; index + offset < callee.parameters.length; index++) {
    const parameter = callee.parameters[index + offset]!;
    if (parameter.dotDotDotToken) {
      if (!ts.isIdentifier(parameter.name) || index >= args.length) break;
      const symbol = checker.getSymbolAtLocation(parameter.name);
      if (symbol === undefined) break;
      next.set(symbol, { values: args.slice(index) });
      break;
    }
    if (index >= args.length) break;
    const value = args[index];
    if (value === undefined) continue;
    bindPattern(parameter.name, value, next, bindings, checker, projectFiles);
  }
  return next;
}

/**
 * The values a tagged template passes AFTER the strings array, in source order.
 * ECMAScript's tagged-template evaluation is exactly this list, so the mapping
 * is read from the syntax rather than inferred.
 */
function templateSubstitutions(call: ts.TaggedTemplateExpression): readonly ts.Expression[] {
  const template = call.template;
  return ts.isTemplateExpression(template) ? template.templateSpans.map((span) => span.expression) : [];
}

/** One parameter's value, bound to the name — or to the names — that receive it. */
function bindPattern(
  name: ts.BindingName,
  value: FlowValue,
  next: Map<ts.Symbol, FlowValue>,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): void {
  if (ts.isIdentifier(name)) {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol) next.set(symbol, value);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const member = patternMember(element, name, value, bindings, checker, projectFiles, new Set());
    if (member !== undefined) bindPattern(element.name, member, next, bindings, checker, projectFiles);
  }
}

/** A finite, stable key for the (callee, bound arguments) pair. */
function bindingsKey(
  callee: ts.FunctionLikeDeclaration,
  bindings: ReadonlyMap<ts.Symbol, FlowValue>,
): string {
  const bound = [...bindings.values()].map(flowValueKey).sort();
  return `${nodeKey(callee)}|${bound.join(",")}`;
}

/**
 * A key for a resolved value. It is STRUCTURAL rather than by identity, because
 * a positional list is built fresh at every call: two calls that bind the same
 * elements must produce the same key or the monotone set that carries
 * termination would never converge. Every leaf is a node of the program's own
 * syntax, so the key space stays finite.
 */
function flowValueKey(value: FlowValue): string {
  const list = flowList(value);
  if (list !== undefined) {
    return `[${list.map((element) => element === undefined ? "?" : flowValueKey(element)).join(",")}]`;
  }
  const options = (value as FlowUnion).options;
  // A union is keyed by its SORTED members, so the same set reached two ways is
  // one key and the monotone set that carries termination converges.
  if (Array.isArray(options)) return `{${options.map(flowValueKey).sort().join("|")}}`;
  return nodeKey(value as ts.Node);
}

function nodeKey(node: ts.Node): string {
  return `${node.getSourceFile().fileName}:${node.pos}:${node.end}`;
}

/** The route through an entered callable, with the hop it contributes. */
function hopped(
  route: readonly string[],
  callable: ts.FunctionLikeDeclaration,
  qualify: boolean,
): readonly string[] {
  const hop = callableRouteHop(callable, qualify);
  return hop === undefined ? route : [...route, hop];
}

function projectCallable(
  declaration: ts.Declaration | undefined,
  projectFiles: ReadonlySet<string>,
): ts.FunctionLikeDeclaration | undefined {
  if (declaration === undefined || !ts.isFunctionLike(declaration)) return undefined;
  const callable = declaration as ts.FunctionLikeDeclaration;
  if (callable.body === undefined) return undefined;
  return projectFiles.has(resolve(callable.getSourceFile().fileName)) ? callable : undefined;
}

/**
 * A class declared in a file this analyzer can read, on exactly the test
 * `projectCallable` applies to a body: `new Date(0)` and every other lib or
 * declaration-file class resolves to nothing here, so no host knowledge is
 * needed to leave them alone.
 */
function projectClass(
  declaration: ts.Declaration | undefined,
  projectFiles: ReadonlySet<string>,
): ts.ClassLikeDeclaration | undefined {
  if (declaration === undefined || !ts.isClassLike(declaration)) return undefined;
  return projectFiles.has(resolve(declaration.getSourceFile().fileName)) ? declaration : undefined;
}

/**
 * The receiver of `f.call(...)`/`f.apply(...)`, which those two run NOW.
 *
 * The checker resolves the call itself to `CallableFunction.call` in `lib.d.ts`,
 * so the signature that actually runs is the receiver's. `isInvokedWhereDefined`
 * already recognizes both spellings when the callable is written at the call
 * site; without this, `(() => process.pid).call(null)` was charged and
 * `const f = () => process.pid; f.call(null)` was not — the same authority, the
 * same invocation, opposite verdicts.
 *
 * `.bind` is deliberately absent. It produces ANOTHER callable rather than
 * running the receiver, and `f.bind(null)` with no following call must stay
 * ordinary; when the bound result IS invoked the checker resolves the outer call
 * to the receiver's signature on its own.
 */
function appliedReceiver(
  call: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
): ts.Declaration | undefined {
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  if (method !== "call" && method !== "apply") return undefined;
  const signatures = checker.getTypeAtLocation(call.expression.expression).getCallSignatures();
  return signatures.length === 1 ? signatures[0]!.declaration : undefined;
}

/**
 * The getter a property READ runs. `o.g` looks like a field access and executes
 * a body, so `const o = { get g() { return process.pid } }` laundered a host
 * read through what reads as a constant.
 *
 * Only a get accessor is entered, and only for a read: a method reached by the
 * same syntax (`o.m`, `keep(o.m)`, `typeof o.m`) is a callable being NAMED, and
 * naming a callable has never been using it.
 *
 * The checker symbol is asked FIRST, and it answers whenever the receiver's type
 * is the class or the literal that declares the accessor. When it does not —
 * because the receiver is annotated with an interface or a structural type, so
 * the symbol is that TYPE'S member and has no body — the SECOND question is
 * asked, the same one `invokedCallables` asks about a call: which value reaches
 * this read. That is the whole of this resolver's old gap. `run(new Impl())`
 * whose body reads `r.read` ran `Impl`'s getter and charged nothing, while the
 * concrete `new Impl().read` was charged, and `const r: Reader = new Impl();
 * r.read` was not — the same authority, the same read, opposite verdicts.
 *
 * It leaves `[1].map(cb)` exactly where it was, for the reason that decides
 * every other lookup by NAME here: `[1]` resolves to a positional list, a list
 * answers a lookup by index and never by name, so no accessor resolves.
 */
function invokedAccessors(
  access: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  bindings: ReadonlyMap<ts.Symbol, FlowValue> = NO_BINDINGS,
): readonly ts.GetAccessorDeclaration[] {
  for (const declaration of checker.getSymbolAtLocation(access.name)?.declarations ?? []) {
    if (ts.isGetAccessorDeclaration(declaration) && declaration.body &&
      projectFiles.has(resolve(declaration.getSourceFile().fileName))) return [declaration];
  }
  const value = flowValue(access.expression, bindings, checker, projectFiles, new Set());
  const found: ts.GetAccessorDeclaration[] = [];
  for (const option of flowOptions(value)) {
    const accessor = accessorOfValue(option, access.name.text, checker, projectFiles);
    if (accessor !== undefined && !found.includes(accessor)) found.push(accessor);
  }
  return found;
}

/**
 * The get accessor a resolved value carries under a name, in an object literal
 * or a class — including one the class inherits, with an OWN member of that name
 * shadowing the base exactly as `classMemberValue` has it, so a clean override
 * of a host-reading base stays clean.
 *
 * A member that is not a get accessor ends the lookup rather than continuing to
 * the base: the own member is what a read of that name reaches, and it is not an
 * accessor, so nothing runs.
 */
function accessorOfValue(
  value: FlowValue | undefined,
  name: string,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): ts.GetAccessorDeclaration | undefined {
  const literal = asObjectLiteral(value);
  if (literal !== undefined) {
    for (const property of literal.properties) {
      if (!namedMember(property, name)) continue;
      return ts.isGetAccessorDeclaration(property) ? projectAccessor(property, projectFiles) : undefined;
    }
    return undefined;
  }
  const declaration = asClass(value);
  if (declaration === undefined) return undefined;
  return classAccessor(declaration, name, checker, projectFiles, new Set());
}

function classAccessor(
  declaration: ts.ClassLikeDeclaration,
  name: string,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  seen: FlowSeen,
): ts.GetAccessorDeclaration | undefined {
  if (seen.has(declaration)) return undefined;
  seen.add(declaration);
  for (const member of declaration.members) {
    if (!namedMember(member, name)) continue;
    return ts.isGetAccessorDeclaration(member) ? projectAccessor(member, projectFiles) : undefined;
  }
  const base = baseClass(declaration, NO_BINDINGS, checker, projectFiles, seen);
  return base === undefined ? undefined : classAccessor(base, name, checker, projectFiles, seen);
}

function namedMember(member: ts.NamedDeclaration, name: string): boolean {
  const memberName = member.name;
  return memberName !== undefined &&
    (ts.isIdentifier(memberName) || ts.isStringLiteral(memberName)) &&
    memberName.text === name;
}

function projectAccessor(
  accessor: ts.GetAccessorDeclaration,
  projectFiles: ReadonlySet<string>,
): ts.GetAccessorDeclaration | undefined {
  return accessor.body !== undefined && projectFiles.has(resolve(accessor.getSourceFile().fileName))
    ? accessor
    : undefined;
}

/**
 * The route hop for an entered callable, spelled like every other hop. An
 * anonymous callable contributes no hop rather than an invented name, so
 * `make()()` reports the route it can prove.
 */
function callableRouteHop(callable: ts.FunctionLikeDeclaration, qualify: boolean): string | undefined {
  const name = callableName(callable);
  if (name === undefined) return undefined;
  return qualify ? `${portableFileName(callable.getSourceFile().fileName)}#${name}` : name;
}

function callableName(callable: ts.FunctionLikeDeclaration): string | undefined {
  const own = callable.name;
  if (own !== undefined && (ts.isIdentifier(own) || ts.isStringLiteral(own))) return own.text;
  const parent = callable.parent;
  if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent)) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}

/**
 * Ambient authority captured by an initializer, charged to whoever reads the
 * binding it produced.
 *
 * The classification is NOT reimplemented here: it is the same
 * `requirementsForAmbientAuthority` table and the same `hostGlobals` set the
 * analyzed function body uses, applied at a different node. That is what makes
 * the two directions agree by construction rather than by a second opinion —
 * `Date.parse`/`Date.UTC` stay exempt, `new Date(0)` stays deterministic,
 * `Math.max` stays ordinary, and a LEXICALLY SHADOWED root stays ordinary
 * because `isAmbientReference` resolves it to a project declaration. Writing a
 * second table here is how this file has previously shipped an over-correction.
 */
function recordAmbientAuthority(
  node: ts.Node,
  route: readonly string[],
  walk: LaunderWalk,
): void {
  if (!ts.isIdentifier(node) || !isValueReferenceIdentifier(node)) return;
  const file = node.getSourceFile();
  const requirements = [...requirementsForAmbientAuthority(node, walk.checker, file)];
  if (hostGlobals.has(node.text) && isAmbientReference(node, walk.checker, file)) {
    requirements.push(`Host<${JSON.stringify(node.text)}>`);
  }
  if (requirements.length === 0) return;
  const reached = [...route, ambientSourceName(node)];
  for (const requirement of requirements) {
    if (!walk.ambient.has(requirement)) walk.ambient.set(requirement, reached);
  }
}

/**
 * The ambient source a route ends at, spelled as it is authored: `process.pid`,
 * `Date.now`, `Math.random`. A requirement such as `Clock` or `Host<"process">`
 * names a service rather than a location, so without this last hop a reader is
 * told a pin failed but not which expression to delete.
 */
function ambientSourceName(node: ts.Identifier): string {
  const member = memberRead(node);
  return member === undefined ? node.text : `${node.text}.${member}`;
}

/**
 * The route through the binding whose initializer is about to be scanned.
 *
 * A module edge's route names laundering MODULES, because the thing to delete is
 * an import. Ambient authority has no specifier, so the thing to delete is the
 * binding itself and the route names it (`config.sm#pid`). When the module hop
 * for that same file is already on the route it is replaced rather than repeated,
 * so `main.sm#pinned -> config.sm#pid -> process.pid` reads as one chain.
 */
function bindingRoute(declaration: ts.Declaration, hops: readonly string[]): readonly string[] {
  const file = portableFileName(declaration.getSourceFile().fileName);
  const name = declarationBindingName(declaration);
  const previous = hops[hops.length - 1] === file ? hops.slice(0, -1) : hops;
  return [...previous, name === undefined ? file : `${file}#${name}`];
}

function declarationBindingName(declaration: ts.Declaration): string | undefined {
  if (ts.isExportAssignment(declaration)) return "default";
  const name = (declaration as ts.NamedDeclaration).name;
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}

/** The project module a resolved binding lives in, when the route skipped it. */
function extendRoute(
  route: readonly string[],
  aliased: ts.Symbol,
  walk: LaunderWalk,
): readonly string[] {
  for (const declaration of aliased.declarations ?? []) {
    const file = declaration.getSourceFile();
    if (!walk.projectFiles.has(resolve(file.fileName))) continue;
    const name = portableFileName(file.fileName);
    return route[route.length - 1] === name ? route : [...route, name];
  }
  return route;
}

function projectModuleFile(
  specifier: ts.StringLiteral,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): ts.SourceFile | undefined {
  const symbol = checker.getSymbolAtLocation(specifier);
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isSourceFile(declaration) && projectFiles.has(resolve(declaration.fileName))) return declaration;
  }
  return undefined;
}

/** Asset import attribute names, mirroring `src/build/source-assets.ts`. */
const ASSET_ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

function assetAttributeName(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * An attributed asset import is a COMPILE-TIME edge and contributes no runtime
 * requirement.
 *
 * `docs/ASSET_LOADERS.md` (Locked): "Loading happens during compilation. It
 * does not add `FileSystem` or another runtime platform requirement to the
 * importing program." Before this test existed, `requirementForModule` saw only
 * the specifier — which for `./config.json` is neither `node:` nor
 * compiler-owned — so every asset read charged the built-in `TypeScript`
 * requirement and NO function reading any asset could be certified
 * native-portable. The pin is the observation channel for that rule, and it was
 * refusing exactly the prompt- and config-embedding code asset loading exists
 * for.
 *
 * The information the classifier was missing is in the AST it already has: the
 * import attributes. This recognizes the same static-import form
 * `compileSourceAssetModules` claims — a `with { ... }` clause (never the
 * legacy `assert` spelling, SMITHERS5202) carrying a non-empty string-literal
 * `type` (SMITHERS5201/5205), on a RELATIVE specifier (SMITHERS5207), with
 * runtime bindings (SMITHERS5208). It is a strict subset of what the stage
 * claims: `isPotentialAsset` there admits EVERY import carrying a `type`
 * attribute, and each condition added here is one that stage also requires
 * before it will proceed.
 *
 * No state is plumbed from the asset stage because none is needed for
 * soundness, in either failure direction. A `type` naming no registered loader
 * fails the stage closed (SMITHERS5213), so loader selection needs no
 * validation here. And when the stage does not run at all, the binding is a
 * foreign value rather than a compiler-generated pure-data module, so the
 * frontend rejects the read: measured over the reading shapes (property read,
 * whole-value use, namespace read, missing file), `compileProject` without the
 * stage reports SMITHERS1506/1508 and, where the specifier resolves to no
 * module at all, SMITHERS1510. Every program whose pin is ever checked is
 * therefore one in which this edge was compiled away.
 *
 * The exemption is a property of the import DECLARATION, never of a specifier
 * namespace: `requirementForModule` is unchanged, still exact-match, and an
 * ordinary relative `.ts`/`.js` import still charges `TypeScript`. A prior lane
 * shipped a fail-open here by making a whole specifier namespace
 * requirement-free; nothing in this test looks at the specifier beyond
 * requiring it to be relative, which the asset stage requires too.
 *
 * The RE-EXPORT spelling is the same claim: `compileSourceAssetModules` records
 * an `export … from "./x.json" with { type: "json" }` as a `"re-export"` asset
 * edge on the same terms, refusing `export * from` an asset (SMITHERS5206) and
 * a type-only or bare-specifier re-export (SMITHERS5208/5207). Since the walk
 * in `requirementForImportedReference` now follows a binding THROUGH a project
 * module's re-export, it reaches those declarations too, and charging them
 * would re-introduce exactly the over-report the import form was fixed for.
 */
function isCompileTimeAssetEdge(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  const attributes = statement.attributes;
  if (attributes === undefined || attributes.token !== ts.SyntaxKind.WithKeyword) return false;
  if (statement.moduleSpecifier === undefined || !ts.isStringLiteral(statement.moduleSpecifier) ||
    !statement.moduleSpecifier.text.startsWith(".")) return false;
  // An asset edge requires runtime bindings. A side-effect-only, `export *`, or
  // type-only edge is not one (SMITHERS5206/5208), so it stays an ordinary
  // module edge.
  if (!hasRuntimeAssetBindings(statement)) return false;
  const seen = new Set<string>();
  let loaderType: string | undefined;
  for (const entry of attributes.elements) {
    const name = assetAttributeName(entry.name);
    // Any attribute the asset stage refuses (a non-static name, a duplicate, a
    // non-literal value) fails that stage closed, so it is not an asset edge.
    if (name === undefined || !ASSET_ATTRIBUTE_NAME.test(name) || seen.has(name)) return false;
    if (!ts.isStringLiteral(entry.value)) return false;
    seen.add(name);
    if (name === "type") loaderType = entry.value.text;
  }
  return loaderType !== undefined && loaderType.trim() !== "";
}

/** `allNamedImportsAreTypeOnly`/`allNamedExportsAreTypeOnly` from the stage. */
function hasRuntimeAssetBindings(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    return clause !== undefined && !clause.isTypeOnly;
  }
  const clause = statement.exportClause;
  if (clause === undefined || statement.isTypeOnly) return false;
  return !(ts.isNamedExports(clause) && clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly));
}

function isAmbientReference(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  _currentFile: ts.SourceFile,
): boolean {
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  if (!symbol) return true;
  if (symbol.flags & ts.SymbolFlags.Alias) return false;
  const declarations = symbol.declarations ?? [];
  return declarations.length === 0 || declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
}

function requirementsForAmbientAuthority(
  node: ts.Node,
  checker: ts.TypeChecker,
  currentFile: ts.SourceFile,
): readonly string[] {
  if (!ts.isIdentifier(node) || !isValueReferenceIdentifier(node) ||
    !["Date", "Math", "performance", "crypto"].includes(node.text) ||
    !isAmbientReference(node, checker, currentFile)) return [];

  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node) {
    const member = ts.isPropertyAccessExpression(parent)
      ? parent.name.text
      : parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression)
        ? parent.argumentExpression.text
        : undefined;
    return ambientRequirementsForMembers(node.text, member === undefined ? undefined : [member]);
  }
  if (node.text === "Date" && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.expression === node) {
    if (ts.isNewExpression(parent) && (parent.arguments?.length ?? 0) > 0) return [];
    return ["Clock"];
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)) {
    return ambientRequirementsForMembers(node.text, bindingMemberNames(parent.name));
  }
  return ambientRequirementsForMembers(node.text, undefined);
}

/** Undefined means the whole root or a dynamically selected member escaped. */
function ambientRequirementsForMembers(root: string, members: readonly string[] | undefined): readonly string[] {
  if (members === undefined) {
    if (root === "Date" || root === "performance") return ["Clock"];
    if (root === "Math") return ["Random"];
    return root === "crypto" ? ['Host<"crypto">'] : [];
  }
  const requirements = new Set<string>();
  for (const member of members) {
    if (root === "Date" && member === "now") requirements.add("Clock");
    else if (root === "Date" && !["parse", "UTC"].includes(member)) requirements.add("Clock");
    else if (root === "Math" && member === "random") requirements.add("Random");
    else if (root === "performance") requirements.add("Clock");
    else if (root === "crypto" && ["randomUUID", "getRandomValues"].includes(member)) requirements.add("Random");
    else if (root === "crypto") requirements.add('Host<"crypto">');
  }
  return [...requirements].sort();
}

function bindingMemberNames(pattern: ts.ObjectBindingPattern): readonly string[] | undefined {
  const names: string[] = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) return undefined;
    const name = element.propertyName ?? element.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
      names.push(name.text);
      continue;
    }
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
      names.push(name.expression.text);
      continue;
    }
    return undefined;
  }
  return names;
}

function checkedProject(sources: Readonly<Record<string, string>>): {
  files: readonly ts.SourceFile[];
  checker: ts.TypeChecker;
  projectFiles: ReadonlySet<string>;
  prelude: ts.SourceFile;
} {
  const root = COMPILER_PROJECT_ROOT;
  const entries = Object.entries(sources);
  if (entries.length === 0) throw new TypeError("compatibility project requires at least one source file");
  const staged = entries.map(([name, source]) => {
    const publicName = resolve(root, isAbsolute(name) ? `.${name}` : name);
    // Every analyzed module is authored Smithers, whatever spelling the caller
    // gave its name: `analyzeCompatibility` stages one source as
    // `compat.sm.ts` and the CLI stages the project's `.sm` files. Recovery
    // therefore runs for all of them, and is the identity for a module that
    // contains no divergent syntax.
    const recovery = recoverSmithersSyntax(source);
    return {
      publicName,
      internalName: publicName.endsWith(".sm") ? `${publicName}.ts` : publicName,
      source: recovery.parseSource,
      recovery,
    };
  });
  const normalized = new Map(staged.map((entry) => [entry.internalName, entry.source]));
  if (normalized.size !== staged.length) throw new TypeError("compatibility project source paths collide");
  if (normalized.has(COMPILER_PRELUDE_NAME)) {
    throw new TypeError("compatibility project source cannot claim the compiler-owned prelude path");
  }
  const stagedByPublicName = new Map(staged.map((entry) => [entry.publicName, entry]));
  const stagedByInternalName = new Map(staged.map((entry) => [entry.internalName, entry]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    types: [],
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalDirectoryExists = host.directoryExists?.bind(host);
  const originalRealpath = host.realpath?.bind(host);
  const virtualDirectories = new Set<string>();
  for (const fileName of normalized.keys()) {
    let directory = resolve(fileName, "..");
    while (!virtualDirectories.has(directory)) {
      virtualDirectories.add(directory);
      const parent = resolve(directory, "..");
      if (parent === directory) break;
      directory = parent;
    }
  }
  // The prelude is checked with the project but is never an analyzed module:
  // it holds no functions, is not a project file, and cannot be imported from.
  const served = new Map(normalized);
  served.set(COMPILER_PRELUDE_NAME, COMPILER_PRELUDE);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = served.get(resolve(name));
    return source === undefined
      ? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(resolve(name), source, languageVersion, true, ts.ScriptKind.TS);
  };
  host.fileExists = (name) => served.has(resolve(name)) || originalFileExists(name);
  host.readFile = (name) => served.get(resolve(name)) ?? originalReadFile(name);
  host.directoryExists = (name) => virtualDirectories.has(resolve(name)) || Boolean(originalDirectoryExists?.(name));
  host.realpath = (name) => served.has(resolve(name)) ? resolve(name) : (originalRealpath?.(name) ?? resolve(name));
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    // A compiler-owned specifier never reaches the filesystem: it binds to the
    // ambient declaration in the prelude or to nothing, never to installed code
    // that happens to occupy the same specifier.
    if (isCompilerOwnedSpecifier(moduleName)) return undefined;
    const containing = stagedByInternalName.get(resolve(containingFile));
    if (containing && moduleName.startsWith(".")) {
      const exact = resolve(containing.publicName, "..", moduleName);
      const candidates = [exact];
      if (!/\.[^/]+$/.test(exact)) candidates.push(`${exact}.sm`, resolve(exact, "index.sm"));
      if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
      const target = candidates.map((candidate) => stagedByPublicName.get(candidate)).find(Boolean);
      if (target) {
        return {
          resolvedFileName: target.internalName,
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
        };
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
  });
  const analyzedNames = [...normalized.keys()];
  const program = ts.createProgram([...analyzedNames, COMPILER_PRELUDE_NAME], options, host);
  const files = analyzedNames.map((fileName) => program.getSourceFile(fileName)).filter((file): file is ts.SourceFile => Boolean(file));
  if (files.length !== analyzedNames.length) throw new Error("compatibility analyzer could not create all checked source files");
  const prelude = program.getSourceFile(COMPILER_PRELUDE_NAME);
  if (!prelude) {
    throw new Error("compatibility analyzer could not load the compiler-owned prelude");
  }
  for (const entry of staged) {
    if (!entry.recovery.changed) continue;
    const file = program.getSourceFile(entry.internalName);
    if (!file) continue;
    authoredPositions.set(file, {
      recovery: entry.recovery,
      lineStarts: computeLineStarts(entry.recovery.authoredSource),
    });
  }
  return { files, checker: program.getTypeChecker(), projectFiles: new Set(analyzedNames), prelude };
}

function isProjectModule(
  specifier: ts.StringLiteral,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): boolean {
  const symbol = checker.getSymbolAtLocation(specifier);
  return isProjectModulePath(specifier.text, specifier.getSourceFile(), projectFiles) ||
    (symbol?.declarations ?? []).some((declaration) =>
      projectFiles.has(resolve(declaration.getSourceFile().fileName)));
}

function isProjectModulePath(
  moduleName: string,
  containingFile: ts.SourceFile,
  projectFiles: ReadonlySet<string>,
): boolean {
  if (!moduleName.startsWith(".")) return false;
  const direct = resolve(containingFile.fileName, "..", moduleName);
  const candidates = [
    direct,
    direct.replace(/\.js$/, ".ts"),
    direct.replace(/\.mjs$/, ".mts"),
    direct.replace(/\.cjs$/, ".cts"),
    `${direct}.ts`,
    resolve(direct, "index.ts"),
  ];
  return candidates.some((candidate) => projectFiles.has(resolve(candidate)));
}

function portableFileName(fileName: string): string {
  const root = resolve("/smithers-compat-project");
  const path = relative(root, fileName).replace(/\.sm\.ts$/, ".sm");
  return path.split(sep).join("/");
}

function requirementForModule(moduleName: string): string | undefined {
  if (moduleName.startsWith("node:")) return `Module<${JSON.stringify(moduleName)}>`;
  if (isCompilerOwnedSpecifier(moduleName)) return undefined;
  return "TypeScript";
}

/**
 * The compiler-owned module registry, mirroring `COMPILER_INTRINSIC_SPECIFIERS`
 * in `src/language/semantic.ts`. Membership is EXACT. The frontend replaced
 * prefix matching with a registry, and this file had kept the prefix form, so
 * any unowned `smithers:`/`smthrs/` specifier was silently requirement-free
 * here while the frontend correctly treated it as foreign code — an
 * under-report in the direction a native pin must never fail.
 *
 * `smithers:native` is this lane's PROVISIONAL entry: the pin spelling is still
 * open in the ledger, so the frontend's registry does not carry it yet.
 */
const COMPILER_OWNED_SPECIFIERS: ReadonlySet<string> = new Set([
  "smthrs/context",
  "smthrs/provider",
  "smthrs/schema-runtime",
  "smithers:exceptions",
  "smithers:comptime",
  "smithers:flows",
  NATIVE_PIN_MODULE,
]);

function isCompilerOwnedSpecifier(specifier: string): boolean {
  return COMPILER_OWNED_SPECIFIERS.has(specifier);
}

function unalias(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!symbol) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * `Capability.context()` on a nominal Context subclass, resolved the way
 * `contextRequirement` in `src/language/semantic.ts` resolves it: through the
 * receiver's checker symbol rather than its spelling, so a renamed import, a
 * namespace read, and a cross-module class all name the same row.
 */
function contextRequirement(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== "context" || call.arguments.length !== 0) {
    return undefined;
  }
  const receiver = call.expression.expression;
  const type = checker.getTypeAtLocation(receiver);
  const symbol = type.getSymbol() ??
    (ts.isIdentifier(receiver) ? unalias(checker.getSymbolAtLocation(receiver), checker) : undefined);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (!declaration?.name || !extendsCompilerContext(declaration, checker)) return undefined;
  return capabilityRowName(declaration, checker, naming);
}

/** A recognized `Layer.provide(layer, body)` and the closure that layer supplies. */
interface LayerProvision {
  readonly callback: ts.Expression | undefined;
  readonly provides: ReadonlySet<string>;
}

/**
 * `Layer.provide(layer, body)`, which RUNS `body` and SATISFIES part of its row.
 *
 * Both halves are Locked, and both were missing. Scoping: "`Layer.provide(layer,
 * body)` MUST keep its environment active through `body` and the Promise
 * returned by `body`, then revoke it" — so the callback is executed, and
 * skipping it made `Layer.provide(layer, () => process.pid)` charge nothing and
 * keep its native pin over a live host read. Satisfaction: "Providing a layer to
 * a computation MUST remove matching capabilities from the computation's
 * unsatisfied requirement row" — so what the layer provides is subtracted, and
 * what it does not is reported. The skipped callback made a satisfied row and an
 * UNSATISFIED one look identical, which is why one entry covered both failures.
 *
 * This is NOT the second table of host knowledge the `.map`/`keep` boundary
 * refuses. Layer Algebra is Locked as "library-shaped; the compiler RECOGNIZES
 * their effect on `R` without introducing special provider grammar", which is
 * the same mandate `contextRequirement` already implements for
 * `Capability.context()`. Authority is CHECKER SYMBOL IDENTITY against this
 * analyzer's own prelude, so a user's `Layer.provide` — or any other library's —
 * resolves to a different symbol and is an ordinary call whose callback stays
 * exactly as unentered as `keep`'s. The recognition covers one symbol, and it is
 * the symbol the specification names.
 *
 * The frontend already models this (`isLayerCall`/`resolveLayerExpression`/
 * `checkLayerSatisfaction` in `src/language/semantic.ts`, SMITHERS2101/2103/
 * 2104), so this is the classifier catching up to a rule the project had already
 * decided, exactly as `invokedCallables` was. An UNSATISFIED capability remains a
 * frontend ERROR (SMITHERS2101, "an unsatisfied capability MUST be a compile
 * error"); what this adds is the classifier's ROW and the pin's own evidence.
 */
function layerProvision(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
): LayerProvision | undefined {
  if (!isLayerCall(call, checker, "provide")) return undefined;
  const layer = call.arguments[0];
  return {
    callback: call.arguments[1],
    provides: layer === undefined ? NOTHING_PROVIDED : layerProvides(layer, checker, naming, new Set()),
  };
}

/** The callback of a recognized `Layer.provide`, for a walk that cannot subtract. */
function layerProvideCallback(call: ts.CallExpression, checker: ts.TypeChecker): ts.Expression | undefined {
  return isLayerCall(call, checker, "provide") ? call.arguments[1] : undefined;
}

function isLayerCall(call: ts.CallExpression, checker: ts.TypeChecker, method: string): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== method) return false;
  const symbol = unalias(checker.getSymbolAtLocation(call.expression.expression), checker);
  return symbol !== undefined && symbol.getName() === "Layer" && isCompilerPreludeSymbol(symbol);
}

/**
 * The nominal capabilities a layer expression provides, mirroring
 * `resolveLayerExpression` in `src/language/semantic.ts` so the two rows agree.
 *
 * An expression this cannot read yields the EMPTY set, which subtracts nothing
 * and leaves the callback's whole row charged. That is the fail-closed
 * direction, and it is also what the frontend does: an opaque layer is
 * SMITHERS2104, "this POC cannot prove its provided capability closure".
 */
function layerProvides(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
  seen: Set<ts.Symbol>,
): ReadonlySet<string> {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) {
    const symbol = unalias(checker.getSymbolAtLocation(node), checker);
    if (symbol === undefined || seen.has(symbol)) return NOTHING_PROVIDED;
    seen.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      const initializer = launderedInitializer(declaration);
      if (initializer) return layerProvides(initializer, checker, naming, seen);
    }
    return NOTHING_PROVIDED;
  }
  if (!ts.isCallExpression(node)) return NOTHING_PROVIDED;
  if (isLayerCall(node, checker, "succeed")) {
    const name = capabilityReferenceName(node.arguments[0], checker, naming);
    return name === undefined ? NOTHING_PROVIDED : new Set([name]);
  }
  if (isLayerCall(node, checker, "merge")) {
    const values = new Set<string>();
    for (const argument of node.arguments) {
      for (const value of layerProvides(argument, checker, naming, new Set(seen))) values.add(value);
    }
    return values;
  }
  return NOTHING_PROVIDED;
}

/**
 * The row name of a capability CLASS reference, resolved the way
 * `contextRequirement` resolves a receiver: through the checker symbol, and only
 * for a class that really extends the compiler-owned `Context`.
 */
function capabilityReferenceName(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
): string | undefined {
  if (expression === undefined) return undefined;
  const symbol = unalias(checker.getSymbolAtLocation(unwrapExpression(expression)), checker);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (!declaration?.name || !extendsCompilerContext(declaration, checker)) return undefined;
  return capabilityRowName(declaration, checker, naming);
}

/**
 * Authority comes from CHECKER SYMBOL IDENTITY: the base must be the `Context`
 * declared in this analyzer's own prelude file. A local class named `Context`,
 * or a `Context` exported by any other package, resolves to a different symbol
 * and confers nothing. This is the stricter of the two reference rules — the
 * frontend also accepts a `smthrs/context` module specifier by name, while
 * the portable backend requires declaration-file identity as it does here.
 */
function extendsCompilerContext(
  declaration: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  seen = new Set<ts.ClassDeclaration>(),
): boolean {
  if (seen.has(declaration)) return false;
  seen.add(declaration);
  const heritage = declaration.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
  for (const typeNode of heritage?.types ?? []) {
    const symbol = unalias(checker.getSymbolAtLocation(typeNode.expression), checker);
    if (!symbol) continue;
    if (symbol.getName() === "Context" && isCompilerPreludeSymbol(symbol)) return true;
    const base = symbol.declarations?.find(ts.isClassDeclaration);
    if (base && extendsCompilerContext(base, checker, seen)) return true;
  }
  return false;
}

function isCompilerPreludeSymbol(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) =>
    resolve(declaration.getSourceFile().fileName) === COMPILER_PRELUDE_NAME);
}

/**
 * Module-qualified capability identity, matching `moduleRowQualifier` and the
 * collision rule in `src/language/semantic.ts`: an unqualified class name is
 * the row name while it is unique across the analyzed modules, and every
 * colliding declaration becomes `Name@module/path` instead.
 */
function buildCapabilityNaming(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): CapabilityNaming {
  const declarationsByName = new Map<string, Array<{ symbol: ts.Symbol; module: string }>>();
  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name && node.heritageClauses?.length &&
        extendsCompilerContext(node, checker)) {
        const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
        if (symbol) {
          const values = declarationsByName.get(node.name.text) ?? [];
          values.push({ symbol, module: moduleRowQualifier(portableFileName(file.fileName)) });
          declarationsByName.set(node.name.text, values);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const bySymbol = new Map<ts.Symbol, string>();
  for (const [name, values] of declarationsByName) {
    if (new Set(values.map((value) => value.symbol)).size < 2) continue;
    for (const value of values) bySymbol.set(value.symbol, `${name}@${value.module}`);
  }
  return { bySymbol };
}

function capabilityRowName(
  declaration: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
): string {
  const name = declaration.name!.text;
  const symbol = unalias(checker.getSymbolAtLocation(declaration.name!), checker);
  return (symbol && naming.bySymbol.get(symbol)) ?? name;
}

function moduleRowQualifier(displayName: string): string {
  return displayName.replace(/\.sm$/, "").replace(/[^A-Za-z0-9._/-]/g, "_");
}

function isValueReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  ) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (
    ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
      ts.isEnumDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)) && parent.name === node) ||
    ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)
  ) return false;
  if (
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  ) return false;
  for (let current: ts.Node | undefined = parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return false;
    if (ts.isExpression(current) || ts.isStatement(current)) break;
  }
  return true;
}

/**
 * The FIRST retained path for a requirement wins, so a shorter route recorded
 * earlier is never replaced by a longer one discovered later. Every retained
 * path is a true route to the same requirement, and keeping the first keeps the
 * diagnostic stable; a lane once shipped a spurious requirement that was
 * inserted at a shallower hop and thereby degraded a real path, so the hazard
 * here is a WRONG row rather than a long one.
 */
function addRequirement(fact: Facts, requirement: string, path: readonly string[]): void {
  if (!fact.direct.has(requirement)) fact.direct.set(requirement, [...path]);
}

function at(
  file: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
  severity: "error" | "warning",
): PortabilityDiagnostic {
  return {
    code,
    message,
    severity,
    file: portableFileName(file.fileName),
    ...authoredPoint(file, node.getStart(file)),
  };
}

/** Derived offset in `file` to a line and column in its authored source. */
function authoredPoint(
  file: ts.SourceFile,
  offset: number,
): { readonly line: number; readonly column: number } {
  const authored = authoredPositions.get(file);
  if (!authored) {
    const position = file.getLineAndCharacterOfPosition(offset);
    return { line: position.line + 1, column: position.character + 1 };
  }
  const { recovery, lineStarts } = authored;
  const mapped = recovery.toAuthored(offset) ?? recovery.toAuthoredAnchor(offset);
  return locateOffset(lineStarts, Math.max(0, Math.min(mapped, recovery.authoredSource.length)));
}
