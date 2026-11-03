// 003-failures.md: TestFailuresSpec/catch-param-default + catch-effect-bridged
// rule: docs/design/src/003-failures.md#4973cb51ea64e753
// 003-failures.md: TestFailuresSpec/catch-param-default + catch-param-computed-key
// rule: docs/design/src/003-failures.md#c30ee7ed074d285e
// 003-failures.md: TestFailuresSpec/generic-unconstrained-substitution + generic-unconstrained-wrapped
// rule: docs/design/src/003-failures.md#49f41114b0ceb860
// 003-failures.md: TestFailuresSpec/generic-unconstrained-substitution + generic-constrained-effectful
// rule: docs/design/src/003-failures.md#73eff5e3e521521c
// 003-failures.md: TestFailuresSpec/generic-unconstrained-substitution + generic-constrained-effectful
// rule: docs/design/src/003-failures.md#e7ec07b0695c3de3
// 003-failures.md: TestFailuresSpec/error-method-overloads + schema-error-method-overloads
// rule: docs/design/src/003-failures.md#59edbba0dddadf66
// 003-failures.md: TestFailuresSpec/class-static-field-effect + class-static-block-effect + class-static-effectful-plain
// rule: docs/design/src/003-failures.md#89a7fbc6a6fe1079
// 003-failures.md: TestFailuresSpec/class-static-never + class-static-joins-plain
// rule: docs/design/src/003-failures.md#b63c96775c9b1055
// 003-failures.md: TestFailuresSpec/catch-effect-param-default + catch-effect-bridged checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#c344b7721cbaac5c
// 003-failures.md: TestFailuresSpec/catch-param-default + catch-param-computed-key checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#5441063883bbd7b2
// 003-failures.md: TestFailuresSpec/promise-union + promise-any-return + promise-unknown-return checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#19c2f1353932b8d0
// 003-failures.md: TestFailuresSpec/declaration-async-rethrows checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#ffbed9dfa63233fb
// 003-failures.md: TestFailuresSpec/rethrows-default-supplied + declaration-rethrows-default checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#5d388ca35c289b71
// 003-failures.md: TestFailuresSpec/declaration-rethrows-default checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#4a14d06cb7bb0d29
// 003-failures.md: TestFailuresSpec/rethrows-default-omitted + rethrows-default-undefined checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#a8ef87003d91bfa2
// 003-failures.md: TestFailuresSpec/generic-unconstrained-substitution + generic-unconstrained-wrapped checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#4349642985277013
// 003-failures.md: TestFailuresSpec/generic-unconstrained-substitution + generic-constrained-effectful checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#4185354a5df5a04e
// 003-failures.md: TestFailuresSpec/rethrows-escape-return + rethrows-escape-nested checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#ba75a03bb362fc7d
// 003-failures.md: TestFailuresSpec/rethrows-escape-return + rethrows-escape-nested + rethrows-escape-store checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#aa196e75bc7ad5d2
// 003-failures.md: TestFailuresSpec/rethrows-escape-return + rethrows-escape-nested checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#f4cb13391da24671
// 003-failures.md: TestFailuresSpec/overload-effect-bound-throw checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#d14ac1d4f5018a57
// 003-failures.md: TestFailuresSpec/overload-effect-bound-throw + overload-effect-bound-ok checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#4c39ce023b4149b0
// 003-failures.md: TestFailuresSpec/match-no-match-implicit + match-guard-call checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#445b709679a4bbe5
// 003-failures.md: TestFailuresSpec/effect-data-last-pipe + effect-data-last-held checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#f2cb62deab292454
// 003-failures.md: TestFailuresSpec/builtin-push-implicit + builtin-object-keys + builtin-json-stringify + builtin-repeat checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#9862cbbdcf5d0715
// 003-failures.md: TestFailuresSpec/builtin-object-keys checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#0cea8d131a4c73b6
// 003-failures.md: TestFailuresSpec/builtin-json-stringify + builtin-repeat checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#dbfd66927659f1bf
// 003-failures.md: TestFailuresSpec/builtin-push-implicit + builtin-object-keys checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#af8eaa7a5e33011e
// 003-failures.md: TestFailuresSpec/throws-tag-ts-ignored checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#60ac2bbeda133d1d
// 003-failures.md: TestFailuresSpec/throws-tag-effect-function + rethrows-tag-effect-function checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#065f91fa4f120d02
// 003-failures.md: TestFailuresSpec/throws-tag-effect-function + throws-tag-effect-returner checks its marked diagnostic or declaration contract
// rule: docs/design/src/003-failures.md#eba096abd2f75919
// 006-data.md: schema-error-computed-key-broad rejects a string domain containing the reserved tag
// rule: docs/design/src/006-data.md#2abcaa1228285d16
package vibelangfuzz

// failuresRound20Cases checks the chapter-3 rules the round-20
// specification added: class evaluation, the implicit derived constructor,
// catch-binding rethrows, foreign function-typed properties, EK0406,
// overrides and implements, service members, the EK0404 Promise test,
// data-last overloads, built-in argument validation and the match protocol.
func failuresRound20Cases() []*failCase {
	var cases []*failCase
	add := func(c *failCase) {
		if c.Owner == "" {
			c.Owner = "w2-throw"
		}
		if c.VIP == 0 {
			c.VIP = 4
		}
		cases = append(cases, c)
	}
	const (
		r20Section        = "This section is the one definition of throw tracking; every other chapter refers to it."
		r20EffectfulBody  = "- A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`"
		r20StaticBullet   = "- **Field initializers and static blocks** run in `new X()` and at class evaluation; a non-`never` class evaluation is `EK0403` in effect code and `EK0401` elsewhere."
		r20InstanceBullet = "- **Field initializers and static blocks** run in `new X()` and at class evaluation; a non-`never` class evaluation is `EK0403` in effect code and `EK0401` elsewhere."
		r20Own            = "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |"
		r20TagEffectful   = "A written `@throws` or `@rethrows` tag there, on a function, service member or function-type signature, is `EK0406`: remove it"
		r20Where          = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`"
		r20Service        = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`, with `service` members as interface members."
		r20PromiseTest    = "`EK0404` uses the Promise test of [Result tests](002-running.md#result-tests): `never`, `any` and `unknown` never trigger it; any union with at least one `PromiseLike` member does."
		r20Async          = "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators."
		r20Builtins       = "**Implicit throws.** A throw from receiver or environment state is implicit"
		r20Match          = "a no-match `TypeError`, a pattern protocol error"
		r20ReduceRow      = "| `Array.prototype.reduce` | without `initialValue`: `@throws {TypeError} @rethrows callbackfn` (`[].reduce(f)` throws); with `initialValue`: `@throws {never} @rethrows callbackfn` |"
		r20DataLast       = "| the data-last overload of every dual export of effect 4.1.1: `map(f)`, `retry(p)`, `catchTag(t, h)` | `@throws {never}`: it only builds a function |"
		r20AppendixE      = "In a `.ts` file, `setTimeout` does not rethrow, because it stores the callback; in a `.vibe` file it is a banned platform global ([Services](005-services.md#the-platform-standard-library)). A shipped annotation always carries `@throws`, so step 2 of [Thrown types](003-failures.md#thrown-types) always finds a type. The array annotations attach to every `lib.d.ts` call signature of the named method, on `Array<T>` and `ReadonlyArray<T>` alike; a tuple uses `Array<T>`'s. An Effect function's data-first overload returns an Effect and is effectful; its data-last overload returns a function and is non-effectful with `@throws {never}`, so `fetchUser(id).pipe(Effect.map(toDto), Effect.retry(policy))` is accepted. Their callbacks have no `@throws`. A library declares the same tags in its own declarations:"
		r20DeclThrows     = "- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one"
		r20Generic        = "A generic signature is classified as effectful before type-argument substitution, through its constraints."
		r20CatchParams    = "A call known to throw in a plain `catch` handler's parameters or body is `EK0401`."
		r20OverloadBound  = "A callable declared in VibeLang (`.vibe` or `.vibex`, outside a `module` body) has thrown type `never`. Nothing is inferred from a body."
		r20ErrorOverloads = "Bodyless plain and `async` overload signatures are methods in both error forms, as in a TypeScript class; they execute no code themselves. For example, `labels()` gives an Effect with `Success([\"ok\", 7])`:"
		r20PromiseRow     = "| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |"
		r20TagRow         = "| a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `\"_tag\"`; use a literal key or a symbol | `EK2117` |"
		r20Defaults       = "/** @throws {\"default\"} */\nexport declare function defaultError(): never\n/** @throws {\"key\"} */\nexport declare function defaultKey(): never\n"
		r20Priority       = "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form."
	)
	add(&failCase{Name: "class-static-field-effect", Owner: "nothrow-impl", Quote: r20StaticBullet, Decls: failParse, Body: "class C { static value = ⟦parse(s)⟧ }", Code: 401})
	add(&failCase{Name: "class-static-block-effect", Owner: "nothrow-impl", Quote: r20StaticBullet, Decls: failParse, Body: "class C { static { ⟦parse(s)⟧ } }", Code: 401})
	add(&failCase{Name: "class-expression-static-effect", Owner: "nothrow-impl", Quote: r20StaticBullet, Decls: failParse, Body: "const C = class { static value = ⟦parse(s)⟧ }", Code: 401})
	add(&failCase{Name: "class-static-never", Quote: r20StaticBullet, Body: "class C { static value = Math.max(1, 2) }"})
	add(&failCase{Name: "class-static-caught", Quote: r20StaticBullet, Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }", Body: "class C { static { try { parse(s) } catch { } } }"})
	add(&failCase{Name: "class-static-joins-plain", Owner: "nothrow-impl", Quote: r20StaticBullet, Decls: failParse + "\nfunction make(s: string) {\n  class C { static value = ⟦parse(s)⟧ }\n  return C\n}", Body: "const C = make(s)", Code: 401})
	add(&failCase{Name: "class-static-effectful-plain", Quote: r20EffectfulBody, Host: "none", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }\nexport function load(s: string) {\n  ⟦class C { static value = parse(s) }⟧\n  return Effect.succeed(C.value)\n}", Code: 401})
	add(&failCase{Name: "class-instance-field-unevaluated", Owner: "nothrow-impl", Quote: r20InstanceBullet, Decls: failParse, Body: "class C { value = ⟦parse(s)⟧ }", Code: 401})
	add(&failCase{Name: "derived-implicit-super", Owner: "nothrow-impl", Quote: r20InstanceBullet, Decls: failParse + "\nclass Base { constructor(readonly s: string) { ⟦parse(s)⟧ } }\nclass Derived extends Base { n = 1 }", Body: "const d = new Derived(s)", Code: 401})
	add(&failCase{Name: "derived-implicit-super-never", Quote: r20InstanceBullet, Decls: "class Base { constructor(readonly s: string) { } }\nclass Derived extends Base { n = 1 }", Body: "const d = new Derived(s)"})
	add(&failCase{Name: "effectful-body-nested-throw", Owner: "nothrow-impl", Quote: nothrowQ.throwStmt, Host: "none", Decls: "export function load(id: string) {\n  function check() { ⟦throw new Error(\"empty\")⟧ }\n  return Effect.succeed(id)\n}", Code: 401})
	add(&failCase{Name: "effectful-body-caught-throw", Owner: "nothrow-impl", Quote: nothrowQ.throwStmt, Host: "none", Decls: "export function load(id: string) {\n  try { if (!id) ⟦throw new Error(\"empty\")⟧ } catch { return Effect.succeed(\"\") }\n  return Effect.succeed(id)\n}", Code: 401})
	add(&failCase{Name: "foreign-function-property", Quote: r20Own, Lib: "export declare const client: { get: () => string }", Body: "⟦client.get()⟧", Code: 403})
	add(&failCase{Name: "foreign-function-field", Quote: r20Own, Lib: "export declare class Client { get: () => string }\nexport declare const client: Client", Body: "⟦client.get()⟧", Code: 403})
	add(&failCase{Name: "local-function-property", Quote: r20Own, Decls: "declare const client: { get: () => string }", Body: "const v = client.get()"})
	add(&failCase{Name: "throws-tag-effect-function", Quote: r20TagEffectful, Host: "none", Decls: "error Absent\n⟦/** @throws {Absent} */\nexport effect function badTag(): number!Absent { throw new Absent() }⟧", Code: 406})
	add(&failCase{Name: "rethrows-tag-effect-function", Quote: r20TagEffectful, Host: "none", Decls: "⟦/** @rethrows f */\nexport effect function run(f: () => number) { return f() }⟧", Code: 406})
	add(&failCase{Name: "throws-tag-effect-returner", Quote: r20TagEffectful, Host: "none", Decls: "⟦/** @throws {Error} */\nexport function load(): Effect.Effect<number> { return Effect.succeed(1) }⟧", Code: 406})
	add(&failCase{Name: "throws-tag-ts-ignored", Quote: "a re-exported foreign callable keeps its contract.", Lib: "import { Effect } from \"effect\"\n/** @throws {Error} @rethrows f */\nexport declare function load(f: () => number): Effect.Effect<number>", Body: "const value = try load(() => 1)"})
	add(&failCase{Name: "assign-class-override", Owner: "nothrow-impl", Quote: "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`", Host: "none", Decls: "class Base { read() { return \"ok\" } }\nexport class Loud extends Base { read() { ⟦throw new Error(\"loud\")⟧ } }", Code: 401})
	add(&failCase{Name: "assign-implements", Owner: "nothrow-impl", Quote: "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`", Host: "none", Decls: "interface Reader { read(): string }\nexport class Bad implements Reader { read(): string { ⟦throw new Error(\"bad\")⟧ } }", Code: 401})
	add(&failCase{Name: "assign-return-written-type", Quote: r20Where, Host: "plain", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }\nfunction make(): (s: string) => string { ⟦return parse⟧ }", Body: "const r = make()", Code: 402})
	add(&failCase{Name: "assign-dts-callback", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n" + "export declare function each(f: () => string): void\n", Body: "each(() => ⟦parse(s)⟧)", Code: 401})
	add(&failCase{Name: "assign-lazyarg", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Decls: failParse, Body: "const v = Option.getOrElse(Option.none<string>(), () => ⟦parse(s)⟧)", Code: 401})
	add(&failCase{Name: "assign-service-member", Owner: "nothrow-impl", Quote: r20Service, Host: "plain", Decls: "service Reader { read(): string }", Body: "const impl: Reader.Shape = { read() { ⟦throw new Error(\"bad\")⟧ } }", Code: 401})
	add(&failCase{Name: "assign-service-layer", Owner: "nothrow-impl", Quote: r20Service, Host: "plain", Decls: "service Reader { read(): string }", Body: "const live = Layer.succeed(Reader, { read() { ⟦throw new Error(\"bad\")⟧ } })", Code: 401})
	add(&failCase{Name: "assign-service-member-never", Quote: r20Service, Host: "plain", Decls: "service Reader { read(): string }", Body: "const live = Layer.succeed(Reader, { read() { return s } })"})
	add(&failCase{Name: "promise-union", Quote: r20PromiseTest, Decls: "function maybeQuery(): Promise<number> | undefined { return undefined }", Body: "const p = ⟦maybeQuery()⟧", Code: 404})
	add(&failCase{Name: "promise-union-wrapped", Quote: r20PromiseTest, Decls: "function maybeQuery(): Promise<number> | undefined { return undefined }", Body: "const p = try Effect.tryPromise(async () => maybeQuery())"})
	add(&failCase{Name: "promise-any-return", Quote: r20PromiseTest, Decls: "function loose(): any { return 1 }", Body: "const v = loose()"})
	add(&failCase{Name: "promise-unknown-return", Quote: r20PromiseTest, Decls: "function opaque(): unknown { return 1 }", Body: "const v = opaque()"})
	add(&failCase{Name: "effect-data-last-pipe", Chapter: "900-appendices.md", Quote: r20DataLast, Body: "const n = try Effect.succeed(1).pipe(Effect.map((n) => n + 1))"})
	add(&failCase{Name: "effect-data-last-held", Quote: r20Async, Body: "const inc = Effect.map((n: number) => n + 1)\nconst n = try inc(Effect.succeed(1))"})
	add(&failCase{Name: "effect-data-last-callback-throw", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Decls: failParse, Body: "const n = try Effect.succeed(s).pipe(Effect.map((t) => ⟦parse(t)⟧))", Code: 401})
	add(&failCase{Name: "rethrows-reduce-no-initial", Chapter: "900-appendices.md", Quote: r20ReduceRow, Body: "const total = ⟦xs.reduce((a, x) => a + x)⟧", Code: 403})
	add(&failCase{Name: "builtin-push-implicit", Quote: r20Builtins, Body: "xs.push(1)"})
	add(&failCase{Name: "builtin-object-keys", Quote: r20Builtins, Body: "const names = Object.keys({ a: 1 })"})
	add(&failCase{Name: "builtin-json-stringify", Quote: r20Builtins, Body: "const t = ⟦JSON.stringify(xs)⟧", Code: 403})
	add(&failCase{Name: "builtin-repeat", Quote: r20Builtins, Body: "const r = ⟦\"ab\".repeat(xs.length)⟧", Code: 403})
	add(&failCase{Name: "builtin-repeat-wrapped", Quote: r20Builtins, Body: "const r = try Effect.try(() => \"x\".repeat(xs.length))"})
	add(&failCase{Name: "match-no-match-implicit", Quote: r20Match, VIP: 7, Decls: "function label(x: unknown) { return match (x) { when 1: \"one\"; } }", Body: "const l = label(s)"})
	add(&failCase{Name: "match-guard-call", Owner: "nothrow-impl", Quote: r20Match, VIP: 7, Decls: "function parsed(s: string) {\n  return match (s) { when let t and if (⟦JSON.parse(t)⟧): 1; default: 0; }\n}", Body: "const n = parsed(s)", Code: 401})
	add(&failCase{Name: "declaration-interface-member", Chapter: "001-functions.md", Owner: "nothrow-impl", Quote: r20DeclThrows, VIP: 27, Host: "none", Decls: "export interface Reader {\n  read(): string\n  size(): number\n}", Throws: map[string]string{"read": "{never}", "size": "{never}"}})
	add(&failCase{Name: "generic-unconstrained-substitution", Quote: r20Generic, Lib: "/** @throws {\"boom\"} */\nexport declare function keep<T>(value: T): T\n", Body: "const e = ⟦keep(Effect.succeed(1))⟧", Code: 403})
	add(&failCase{Name: "generic-unconstrained-wrapped", Quote: r20Generic, Lib: "/** @throws {\"boom\"} */\nexport declare function keep<T>(value: T): T\n", Body: "const e = try Effect.try(() => keep(Effect.succeed(1)))\nconst n = try e"})
	add(&failCase{Name: "generic-constrained-effectful", Quote: r20Generic, Decls: "function passEffect<T extends Effect.Effect<unknown>>(value: T): T { return value }", Body: "const n = try passEffect(Effect.succeed(2))"})
	add(&failCase{Name: "catch-param-default", Owner: "nothrow-impl", Quote: r20CatchParams, VIP: 5, Lib: r20Defaults, Body: "return Effect.fail(undefined) catch (e: unknown = ⟦defaultError()⟧) => 7", Code: 401})
	add(&failCase{Name: "catch-param-computed-key", Owner: "nothrow-impl", Quote: r20CatchParams, VIP: 5, Lib: r20Defaults, Body: "return Effect.fail({}) catch ({ [⟦defaultKey()⟧]: value }: any) => 7", Code: 401})
	add(&failCase{Name: "catch-param-lazy-default", Owner: "nothrow-impl", Quote: r20CatchParams, VIP: 5, Lib: r20Defaults, Body: "return Effect.fail(undefined) catch (e: unknown = () => ⟦defaultError()⟧) => 7", Code: 401})
	add(&failCase{Name: "catch-effect-param-default", Quote: r20CatchParams, VIP: 5, Lib: r20Defaults, Body: "return Effect.fail(undefined) catch effect (e: unknown = ⟦defaultError()⟧) => 7", Code: 401})
	add(&failCase{Name: "catch-effect-bridged", Quote: r20CatchParams, VIP: 5, Lib: r20Defaults, Body: "return Effect.fail(undefined) catch effect (input) => {\n  if (input === undefined) try Effect.try({ try: () => defaultError(), catch: (error) => error })\n  return 7\n}"})
	add(&failCase{Name: "overload-effect-bound-throw", Owner: "nothrow-impl", Quote: r20OverloadBound, Host: "none", Decls: "export function pick(x: string): Effect.Effect<string>\nexport function pick(x: number): number\nexport function pick(x: string | number): Effect.Effect<string> | number {\n  if (x === \"\") ⟦throw new Error(\"empty\")⟧\n  return typeof x === \"string\" ? Effect.succeed(x) : x\n}", Code: 401})
	add(&failCase{Name: "overload-effect-bound-ok", Quote: r20OverloadBound, Host: "none", Decls: "export function pick(x: string): Effect.Effect<string>\nexport function pick(x: number): number\nexport function pick(x: string | number): Effect.Effect<string> | number {\n  return typeof x === \"string\" ? Effect.succeed(x) : x\n}"})
	add(&failCase{Name: "error-method-overloads", Quote: r20ErrorOverloads, VIP: 13, Owner: "fix-vip-decls", Host: "none", Decls: "export error Plain {\n  label(x: string): string;\n  label(x: number): number;\n  label(x: string | number) { return x }\n}\nexport const labelled = new Plain().label(\"ok\")"})
	add(&failCase{Name: "schema-error-method-overloads", Quote: r20ErrorOverloads, VIP: 29, Owner: "fix-vip-decls", Host: "none", Decls: "export schema error Encoded {\n  label(x: string): string;\n  label(x: number): number;\n  label(x: string | number) { return x }\n}\nexport const labelled = new Encoded().label(7)"})
	add(&failCase{Name: "assign-async-default-throw", Quote: r20Async, Host: "plain", Decls: failParse + "\nasync function load(s: string = parse(\"\")) { return s }", Body: "const r: () => Promise<string> = load"})
	add(&failCase{Name: "assign-promise-plain-throws", Owner: "nothrow-impl", Quote: nothrowQ.throwStmt, Host: "plain", Decls: "function start(s: string): Promise<string> { if (!s) ⟦throw new Error(\"empty\")⟧; return Promise.resolve(s) }", Body: "const r: (s: string) => Promise<string> = start", Code: 401})
	add(&failCase{Name: "promise-tagged-template", Quote: r20PromiseRow, Decls: "function tag(parts: TemplateStringsArray): Promise<number> { return Promise.resolve(parts.length) }", Body: "const p = ⟦tag`x`⟧", Code: 404})
	add(&failCase{Name: "schema-error-computed-key-broad", Quote: r20TagRow, VIP: 29, Owner: "fix-vip-decls", Host: "none", Decls: "declare const key: string\n⟦export schema error Entry { [key]: number }⟧", Code: 2117})
	add(&failCase{Name: "error-async-effect-getter-priority", Quote: r20Priority, VIP: 13, Owner: "core-land", Host: "none", Decls: "⟦export error Entry { async effect get x() { return 1 } }⟧", Code: 104, AlsoCodes: []int{105}, NotCodes: []int{1301, 1302, 1303, 1304, 2117}})
	add(&failCase{Name: "schema-error-async-effect-getter-priority", Quote: r20Priority, VIP: 29, Owner: "core-land", Host: "none", Decls: "⟦export schema error Entry { async effect get x() { return 1 } }⟧", Code: 104, AlsoCodes: []int{105}, NotCodes: []int{1301, 1302, 1303, 1304, 2117}})
	return cases
}
