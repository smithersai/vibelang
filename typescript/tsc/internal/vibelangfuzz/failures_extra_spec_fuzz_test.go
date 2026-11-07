package vibelangfuzz

// Additional chapter-3 boundaries; kept separate from the frozen first slice.
func failuresExtraCases() []*failCase {
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
	const effectful = "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. For example, in Effect 4.1.1 this includes `Exit` values, `Config` programs, `error` instances, service keys and references; this is not an exhaustive list. A plain function whose return type is wholly one of these Effect subtypes is effectful and may not throw: `function bad(): Exit.Exit<number> { throw \"x\" }` is `EK0401`. `Stream` and `Layer` have their separate effectful-return categories above; neither they nor `Fiber` pass the Effect execution operand test. An effectful callable's thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator. Evaluated in a parameter default, before the Effect exists, it throws a JavaScript exception at the call of a plain function, and makes the call of an `effect` function return an Effect that dies with the thrown value, as an `async` function's call returns a rejected Promise ([Functions](001-functions.md#meaning), [Code outside the generator](#code-outside-the-generator))."
	const effectfulBody = "- A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`"
	add(&failCase{Name: "effectful-service-key", Quote: effectful, Decls: "service Store { static readonly key = \"fuzz/failures/key\"; value: number }\nfunction key() { return Store }", Body: "const value = key()"})
	add(&failCase{Name: "effectful-service-reference", Quote: effectful, Decls: "service Store {\n static readonly key = \"fuzz/failures/reference\"\n static readonly defaultValue = () => ({ value: 1 })\n value: number\n}\nfunction key() { return Store }", Body: "const value = key()"})
	add(&failCase{Name: "effectful-service-member", Quote: "a service member typed as an Effect", Lib: "import { Effect } from \"effect\"\nexport declare const store: { load(): Effect.Effect<number> }", Body: "const value = store.load()"})
	// Effect subtypes: assignability, not the Effect interface's identity,
	// makes a callable effectful, so its written @throws does not apply in
	// effect code or in plain code. A union with undefined is not effectful.
	for _, subtype := range []struct{ name, ret string }{
		{"exit", "Exit.Exit<number>"},
		{"config", "Config.Config<string>"},
		{"error", "Cause.NoSuchElementError"},
		{"union", "Exit.Exit<number> | Effect.Effect<string>"},
	} {
		lib := "import type { Cause, Config, Effect, Exit } from \"effect\"\n/** @throws {RangeError} */\nexport declare function subtype(): " + subtype.ret
		add(&failCase{Name: "effectful-subtype-" + subtype.name, Quote: effectful, Lib: lib, Body: "const value = subtype()"})
		add(&failCase{Name: "effectful-subtype-" + subtype.name + "-plain", Quote: effectful, Host: "plain", Lib: lib, Body: "const value = subtype()"})
	}
	add(&failCase{Name: "effectful-subtype-optional", Quote: effectful, Code: 403, Lib: "import type { Exit } from \"effect\"\n/** @throws {RangeError} */\nexport declare function subtype(): Exit.Exit<number> | undefined", Body: "const value = ⟦subtype()⟧"})
	for _, decl := range []struct{ name, body string }{
		{"key", "service Store { static readonly key = \"fuzz/failures/key\"; value: number }"},
		{"reference", "service Store {\n static readonly key = \"fuzz/failures/reference\"\n static readonly defaultValue = () => ({ value: 1 })\n value: number\n}"},
	} {
		add(&failCase{Name: "effectful-service-" + decl.name + "-throw", Quote: effectfulBody, Code: 401, Host: "none", Decls: decl.body + "\nexport function key(): typeof Store { ⟦throw new Error(\"bad\")⟧; return Store }"})
	}
	// The stricter body rule: in a plain function whose return type is wholly
	// effectful, a call whose throwing is unknown is EK0401 too, unless a try
	// block with a catch clause in the same function encloses it.
	const unknownLib = "export declare function untagged(): number\nexport declare class Untagged { value: number }\n/** @throws {never} */\nexport declare function safe(): number"
	for _, body := range []struct{ name, decls string }{
		{"effect", "export function probeBody(): Effect.Effect<number> { ⟦untagged()⟧; return Effect.succeed(1) }"},
		{"exit", "import { Exit } from \"effect\"\nexport function probeBody(): Exit.Exit<number> { return Exit.succeed(⟦untagged()⟧) }"},
		{"arrow-stream", "import { Stream } from \"effect\"\nexport const probeBody = (): Stream.Stream<number> => Stream.make(⟦untagged()⟧)"},
		{"inferred", "export function probeBody() { const n = ⟦untagged()⟧; return Effect.succeed(n) }"},
		{"default", "export function probeBody(p = ⟦untagged()⟧): Effect.Effect<number> { return Effect.succeed(p) }"},
		{"arrow-default", "export const probeBody = (p = ⟦untagged()⟧): Effect.Effect<number> => Effect.succeed(p)"},
	} {
		add(&failCase{Name: "effectful-body-unknown-" + body.name, Quote: effectfulBody, Code: 401, Host: "none", Lib: unknownLib, Decls: body.decls})
	}
	for _, body := range []struct{ name, decls string }{
		{"caught", "export function probeBody(): Effect.Effect<number> { try { untagged() } catch { } return Effect.succeed(1) }"},
		{"never", "export function probeBody(): Effect.Effect<number> { safe(); return Effect.succeed(1) }"},
		{"partial", "export function probeBody(): Effect.Effect<number> | undefined { untagged(); return undefined }"},
		{"plain", "export function probeBody() { return untagged() }"},
		{"plain-default", "export function probeBody(p = untagged()) { return p }"},
		{"nested", "export function probeBody(): Effect.Effect<number> { const f = () => untagged(); return Effect.sync(f) }"},
	} {
		add(&failCase{Name: "effectful-body-control-" + body.name, Quote: effectfulBody, Host: "none", Lib: unknownLib, Decls: body.decls})
	}
	// A Promise return alone does not establish synchronous non-throwing.
	const unknownPromise = "export declare function raw(): Promise<number>\n/** @throws {never} */\nexport declare function safe(): Promise<number>"
	for _, body := range []struct{ name, decls string }{
		{"effect-default", "export effect function probe(p = ⟦raw()⟧) { return p }"},
		{"producer-default", "export effect function* probe(p = ⟦raw()⟧) { yield p }"},
		{"factory-body", "export function probe(): Effect.Effect<number> { ⟦raw()⟧; return Effect.succeed(1) }"},
		{"factory-default", "export function probe(p = ⟦raw()⟧): Effect.Effect<number> { return Effect.succeed(1) }"},
		{"arrow-default", "export const probe = (p = ⟦raw()⟧): Effect.Effect<number> => Effect.succeed(1)"},
		{"binding-default", "export effect function probe({ p = ⟦raw()⟧ }: { p?: Promise<number> }) { return p }"},
	} {
		add(&failCase{Name: "unknown-promise-" + body.name, Quote: effectfulBody, Code: 401, Host: "none", Lib: unknownPromise, Decls: body.decls})
	}
	for _, body := range []struct{ name, decls string }{
		{"caught", "export function probe(): Effect.Effect<number> { try { raw() } catch {} return Effect.succeed(1) }"},
		{"ordinary", "export function probe(p = raw()) { return p }"},
		{"async", "export async function probe(p = raw()) { return p }"},
		{"never", "export effect function probe(p = safe()) { return p }"},
		{"intrinsic", "export effect function probe(p = Promise.resolve(1)) { return p }"},
		{"local", "async function local() { return 1 }\nexport effect function probe(p = local()) { return p }"},
	} {
		add(&failCase{Name: "unknown-promise-control-" + body.name, Quote: effectfulBody, Host: "none", Lib: unknownPromise, Decls: body.decls})
	}
	// Erasing a callable signature keeps unknown throws at eager defaults.
	for _, typ := range []struct{ name, value string }{{"any", "any"}, {"function", "Function"}} {
		for _, body := range []struct{ name, decls string }{
			{"effect", "export effect function probe(p = ⟦invoke()⟧) { return p }"},
			{"producer", "export effect function* probe(p = ⟦invoke()⟧) { yield p }"},
			{"binding", "export effect function probe({ p = ⟦invoke()⟧ }: { p?: number }) { return p }"},
		} {
			add(&failCase{Name: "erased-default-" + typ.name + "-" + body.name, Quote: effectfulBody, Code: 401, Host: "none", Decls: "declare const invoke: " + typ.value + "\n" + body.decls})
		}
		for _, body := range []struct{ name, decls string }{
			{"plain", "export function probe(p = invoke()) { return p }"},
			{"async", "export async function probe(p = invoke()) { return p }"},
		} {
			add(&failCase{Name: "erased-default-control-" + typ.name + "-" + body.name, Quote: effectfulBody, Host: "none", Decls: "declare const invoke: " + typ.value + "\n" + body.decls})
		}
	}
	// Stream results use full assignability, as specified for effectful callables.
	const streamReturns = "import type { Stream } from \"effect\"\nexport type Marker = Pick<Stream.Stream<number>, typeof Stream.TypeId>\nexport type NoChannel = Omit<Stream.Stream<number>, \"channel\">\nexport type NoPipe = Omit<Stream.Stream<number>, \"pipe\">\nexport type View = { readonly [K in keyof Stream.Stream<number>]: Stream.Stream<number>[K] }\nexport declare function marker(): Marker\nexport declare function noChannel(): NoChannel\nexport declare function noPipe(): NoPipe\nexport declare function whole(): Stream.Stream<number>\nexport declare function view(): View\nexport declare function mixed(): Marker | Stream.Stream<number>\nexport declare function constrained<T extends Marker>(): T\nexport declare function complete<T extends Stream.Stream<number>>(): T\nexport declare function untagged(): number\n/** @throws {never} */\nexport declare function safeMarker(): Marker\n/** @throws {RangeError} */\nexport declare function knownMarker(): Marker"
	for _, call := range []struct{ name, expr string }{
		{"marker", "marker()"}, {"no-channel", "noChannel()"}, {"no-pipe", "noPipe()"},
		{"mixed", "mixed()"}, {"constraint", "constrained()"}, {"known", "knownMarker()"},
	} {
		add(&failCase{Name: "stream-return-" + call.name, Quote: effectful, Code: 403, Lib: streamReturns, Body: "const value = ⟦" + call.expr + "⟧"})
	}
	for _, call := range []struct{ name, expr string }{
		{"whole", "whole()"}, {"view", "view()"}, {"constraint", "complete()"}, {"never", "safeMarker()"},
	} {
		add(&failCase{Name: "stream-return-control-" + call.name, Quote: effectful, Lib: streamReturns, Body: "const value = " + call.expr})
	}
	for _, body := range []struct{ name, decls string }{
		{"body", "export function probe(): ReturnType<typeof marker> { untagged(); return marker() }"},
		{"default", "export function probe(p = untagged()): ReturnType<typeof marker> { return marker() }"},
	} {
		add(&failCase{Name: "stream-return-plain-" + body.name, Quote: effectful, Host: "none", Lib: streamReturns, Decls: body.decls})
	}
	// Optional invocation changes reference evaluation, not the selected
	// callable's original return contract.
	const nullableResults = "import type { Effect, Stream, Layer, Exit } from \"effect\"\n/** @throws {RangeError} */\nexport declare function maybeEffect(): Effect.Effect<number> | undefined\n/** @throws {RangeError} */\nexport declare function maybeStream(): Stream.Stream<number> | null\n/** @throws {RangeError} */\nexport declare function maybeLayer(): Layer.Layer<never> | undefined\n/** @throws {RangeError} */\nexport declare function maybeExit(): Exit.Exit<number> | undefined\n/** @throws {RangeError} */\nexport declare function genericMaybe<T extends Effect.Effect<number> | undefined>(): T\n/** @throws {RangeError} */\nexport declare const optionalWhole: (() => Effect.Effect<number>) | undefined\n/** @throws {never} */\nexport declare function safeMaybe(): Effect.Effect<number> | undefined\nexport declare function unknownMaybe(): Effect.Effect<number> | undefined\n/** @throws {RangeError} */\nexport declare const composite: (() => Effect.Effect<number> | undefined) | (() => Effect.Effect<string> | undefined)\n/** @throws {RangeError} */\nexport declare function overloaded(value: number): Effect.Effect<number> | undefined\n/** @throws {RangeError} */\nexport declare function overloaded(value: string): Stream.Stream<string> | null\nexport declare const box: {\n  /** @throws {RangeError} */\n  read(): Effect.Effect<number> | undefined\n  whole(): Effect.Effect<number>\n} | undefined\nexport declare const optionalStream: (() => Stream.Stream<number>) | undefined\n"
	for _, call := range []struct{ name, expr string }{
		{"effect", "maybeEffect?.()"}, {"stream", "maybeStream?.()"}, {"layer", "maybeLayer?.()"},
		{"exit", "maybeExit?.()"}, {"generic", "genericMaybe?.()"},
		{"unknown", "unknownMaybe?.()"}, {"composite", "composite?.()"},
		{"overload", "overloaded?.(1)"}, {"property", "box?.read()"},
	} {
		add(&failCase{Name: "nullable-return-" + call.name, Quote: effectful, Code: 403, Lib: nullableResults, Body: "const value = ⟦" + call.expr + "⟧"})
	}
	for _, call := range []struct{ name, expr string }{
		{"optional-reference", "optionalWhole?.()"}, {"never", "safeMaybe?.()"},
		{"stream-reference", "optionalStream?.()"}, {"property-reference", "box?.whole()"},
		{"bridge", "try Effect.orDie(Effect.try(() => maybeEffect?.()))"},
	} {
		add(&failCase{Name: "nullable-return-control-" + call.name, Quote: effectful, Lib: nullableResults, Body: "const value = " + call.expr})
	}
	// Complete Layer assignability is distinct from extracting variance
	// channels. The partial views below have no pipe contract; a property
	// with variance-shaped fields does not supply the Layer marker either.
	const layerReturns = "import type { Layer } from \"effect\"\nexport type Marker = Pick<Layer.Layer<unknown>, \"~effect/Layer\">\nexport type NoPipe = Omit<Layer.Layer<unknown>, \"pipe\">\nexport type Fake = { other: { _ROut: (_: unknown) => void, _E: () => never, _RIn: () => never } }\nexport type View = { readonly [K in keyof Layer.Layer<unknown>]: Layer.Layer<unknown>[K] }\nexport declare function marker(): Marker\nexport declare function noPipe(): NoPipe\nexport declare function fake(): Fake\nexport declare function mixed(): Marker | Layer.Layer<unknown>\nexport declare function constrained<T extends Marker>(): T\nexport declare function complete<T extends Layer.Layer<unknown>>(): T\nexport declare function unconstrained<T>(): T\nexport declare function whole(): Layer.Layer<unknown>\nexport declare function view(): View\nexport declare function untagged(): number\n/** @throws {RangeError} */\nexport declare function knownMarker(): Marker\n/** @throws {never} */\nexport declare function safeMarker(): Marker\n"
	for _, call := range []struct{ name, expr string }{
		{"marker", "marker()"}, {"no-pipe", "noPipe()"}, {"fake", "fake()"},
		{"union", "mixed()"}, {"constraint", "constrained()"}, {"known", "knownMarker()"},
	} {
		add(&failCase{Name: "layer-return-" + call.name, Owner: "compiler", Quote: effectful, Code: 403, Lib: layerReturns, Body: "const value = ⟦" + call.expr + "⟧"})
	}
	for _, call := range []struct{ name, expr string }{
		{"whole", "whole()"}, {"view", "view()"}, {"constraint", "complete()"}, {"never", "safeMarker()"},
		{"bridge", "try Effect.orDie(Effect.try(() => marker()))"},
	} {
		add(&failCase{Name: "layer-return-control-" + call.name, Owner: "compiler", Quote: effectful, Lib: layerReturns, Body: "const value = " + call.expr})
	}
	add(&failCase{Name: "layer-return-control-unconstrained", Owner: "compiler", Quote: effectful, Code: 403, Lib: layerReturns, Body: "const value = ⟦unconstrained<ReturnType<typeof marker>>()⟧"})
	for _, body := range []struct{ name, decls string }{
		{"body", "export function probe(): ReturnType<typeof marker> { untagged(); return marker() }"},
		{"default", "export function probe(p = untagged()): ReturnType<typeof marker> { return marker() }"},
	} {
		add(&failCase{Name: "layer-return-plain-" + body.name, Owner: "compiler", Quote: effectful, Host: "none", Lib: layerReturns, Decls: body.decls})
	}
	const methods = "[ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13)."
	const rejected = "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |"
	const priority = "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form."
	const keyRule = "In a plain `error`, fields are type-only payload members whose keys use TypeScript's `TypeLiteral` member admission, matching `Data.TaggedError`'s payload type."
	const schemaKeyRule = "`schema error` field keys instead use the runtime object literal admission of `Schema.TaggedError`'s fields object ([Schema declarations](006-data.md#schema-declarations)), together with the existing `_tag` exclusion checks."
	const greedy = "The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete."
	for _, form := range []struct {
		name, syntax, keyRule string
		vip                   int
	}{{"error", "error", keyRule, 13}, {"schema-error", "schema error", schemaKeyRule, 29}} {
		for _, method := range []struct{ name, code string }{
			{"plain-method", "value() { return this.id }"},
			{"async-method", "async value() { return this.id }"},
			{"generator-method", "*values() { yield this.id }"},
			{"async-generator-method", "async *values() { yield this.id }"},
			{"effect-method", "effect value() { return this.id }"},
			{"producer-method", "effect *values() { yield this.id }"},
			{"private-method", "#value() { return this.id }\nvalue() { return this.#value() }"},
			{"protected-method", "protected value() { return this.id }"},
		} {
			add(&failCase{Name: form.name + "-" + method.name, Quote: methods, VIP: form.vip, Owner: "core-land", Host: "none", Decls: "export " + form.syntax + " Entry { id: string;\n" + method.code + "\n}"})
		}
		for _, member := range []struct{ name, code string }{
			{"private-modifier", "private id: string"},
			{"declare-field", "declare id: string"},
			{"accessor-field", "accessor id = 1"},
		} {
			add(&failCase{Name: form.name + "-rejected-" + member.name, Quote: rejected, VIP: form.vip, Owner: "fix-vip-decls", Host: "none", Code: 1304, OneDiagnostic: true, Decls: "⟦export " + form.syntax + " Entry { " + member.code + " }⟧"})
		}
		for _, member := range []struct{ name, code string }{
			{"effect-getter", "effect get value() { return 1 }"},
			{"effect-setter", "effect set value(n: number) {}"},
			{"effect-constructor", "effect constructor() { super() }"},
		} {
			add(&failCase{Name: form.name + "-" + member.name + "-priority", Quote: priority, VIP: form.vip, Owner: "core-land", Host: "none", Code: 104, NotCodes: []int{1301, 1302, 1303, 1304, 2117}, Decls: "⟦export " + form.syntax + " Entry { " + member.code + " }⟧"})
		}
		add(&failCase{Name: form.name + "-literal-computed-keys", Quote: form.keyRule, VIP: form.vip, Owner: "fix-vip-decls", Host: "none", Decls: "const key = \"computed\" as const\nexport " + form.syntax + " Entry { \"quoted\": number; 7: number; [key]: number }\nexport const entry = new Entry({ quoted: 1, 7: 2, computed: 3 })"})
		add(&failCase{Name: form.name + "-multiline-type", Quote: greedy, VIP: form.vip, Owner: "fix-vip-decls", Host: "none", Decls: "export " + form.syntax + " Entry { role:\n | \"admin\"\n | \"member\"\n get message() { return this.role }\n}"})
	}

	const wrapperRule = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`)."
	add(&failCase{Name: "wrapper-callback-throw", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Code: 401, Decls: failParse, Body: "const p = Effect.callback<number>(() => { ⟦parse(s)⟧ })"})
	add(&failCase{Name: "wrapper-suspend-throw", Quote: effectfulBody, Code: 401, Decls: failParse, Body: "const p = Effect.suspend(() => { ⟦parse(s)⟧; return Effect.succeed(1) })"})
	const direct = "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))`. In a plain `catch` handler and other plain code, a call known to throw is `EK0401` ([Plain code never throws](#plain-code-never-throws)) | `EK0403` |"
	// Invocations other than calls: a new expression and a tagged template
	// follow the same rule in effect code and in a wholly effectful plain
	// function. Lib constructors and VibeLang classes are not tracked.
	const invocationRule = "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |"
	const invocationLib = "export declare class Explicit { constructor(n: number); readonly n: number }\nexport declare class Known {\n  /** @throws {RangeError} */\n  constructor(n: number)\n}\nexport declare class Safe {\n  /** @throws {never} */\n  constructor()\n}\nexport declare function untaggedTag(parts: TemplateStringsArray): number"
	for _, row := range []struct{ name, body string }{
		{"new-untagged", "const v = ⟦new Explicit(1)⟧"},
		{"new-known", "const v = ⟦new Known(1)⟧"},
		{"tag-untagged", "const v = ⟦untaggedTag`x`⟧"},
	} {
		add(&failCase{Name: "effect-invocation-" + row.name, Quote: invocationRule, Code: 403, Lib: invocationLib, Body: row.body})
	}
	add(&failCase{Name: "effect-invocation-plain-effectful-new", Quote: effectfulBody, Code: 401, Host: "none", Lib: invocationLib, Decls: "export function probeBody(): Effect.Effect<number> { return Effect.succeed(⟦new Explicit(1)⟧.n) }"})
	for _, row := range []struct{ name, body string }{
		{"new-safe", "const v = new Safe()"},
		{"new-wrapped", "const v = try Effect.try(() => new Explicit(1))"},
		{"new-map", "const v = new Map<string, number>()"},
		{"new-error", "const v = new Error(\"x\")"},
	} {
		add(&failCase{Name: "effect-invocation-control-" + row.name, Quote: invocationRule, Lib: invocationLib, Body: row.body})
	}
	add(&failCase{Name: "catch-tracked-new", Owner: "nothrow-impl", Quote: nothrowQ.handler, Code: 401, Decls: failInput, Body: "const p = Effect.fail(\"bad\") catch () => ⟦new Input(s)⟧"})
	add(&failCase{Name: "catch-tracked-template", Owner: "nothrow-impl", Quote: nothrowQ.handler, Code: 401, Lib: "/** @throws {Error} */\nexport declare function tag(parts: TemplateStringsArray): never\n", Body: "const p = Effect.fail(\"bad\") catch () => ⟦tag`x`⟧"})
	const producing = "| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |"
	add(&failCase{Name: "promise-new", Quote: producing, Code: 404, Body: "const p = ⟦new Promise<number>((resolve) => resolve(1))⟧"})
	// A super(...) call runs the base class constructor in a constructor,
	// which is plain code: a base constructor known to throw is EK0401 there.
	const knownCall = "A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`"
	const superLib = "export declare class Known {\n  /** @throws {RangeError} */\n  constructor(n: number)\n}\nexport declare class Safe {\n  /** @throws {never} */\n  constructor(n: number)\n}\nexport declare class Untagged { constructor(n: number) }\n"
	add(&failCase{Name: "super-known", Owner: "compiler", Quote: knownCall, Code: 401, Host: "none", Lib: superLib, Decls: "export class C extends Known { constructor() { ⟦super(1)⟧ } }"})
	add(&failCase{Name: "super-known-field", Owner: "compiler", Quote: knownCall, Code: 401, Host: "none", Lib: superLib, Decls: "export class C extends Known {\n  readonly v = 1\n  constructor(n: number) { ⟦super(n)⟧ }\n}"})
	for _, row := range []struct{ name, decls string }{
		{"untagged", "export class C extends Untagged { constructor() { super(1) } }"},
		{"never", "export class C extends Safe { constructor() { super(1) } }"},
		{"implicit", "export class C extends Known {}"},
	} {
		add(&failCase{Name: "super-control-" + row.name, Owner: "compiler", Quote: knownCall, Host: "none", Lib: superLib, Decls: row.decls})
	}

	// An explicit base-constructor call also combines the contract of each
	// callback named by @rethrows, even with an own never contract.
	const superRethrowsRule = "or has a `@rethrows` parameter given a callback known to throw."
	const superRethrowsLib = "/** @throws {RangeError} */\nexport declare function risky(): number\n/** @throws {never} */\nexport declare function safe(): number\nexport declare function untagged(): number\nexport declare class Base {\n /** @throws {never}\n  * @rethrows cb */\n constructor(cb: () => number)\n}\nexport declare class Generic<T> {\n /** @throws {never}\n  * @rethrows cb */\n constructor(cb: () => T)\n}\nexport declare class Rest {\n /** @throws {never}\n  * @rethrows callbacks */\n constructor(...callbacks: (() => number)[])\n}\n"
	for _, row := range []struct{ name, base, prefix, body string }{
		{"known", "Base", "", "⟦super(risky)⟧"},
		{"literal", "Base", "", "⟦super(() => risky())⟧"},
		{"conditional", "Base", "declare const flag: boolean\n", "⟦super(flag ? risky : safe)⟧"},
		{"alias", "Base", "const saved = risky\n", "⟦super(saved)⟧"},
		{"spread", "Base", "const callbacks = [risky] as const\n", "⟦super(...callbacks)⟧"},
		{"generic", "Generic<number>", "", "⟦super(risky)⟧"},
		{"rest", "Rest", "", "⟦super(safe, risky)⟧"},
		{"control-safe", "Base", "", "super(safe)"},
		{"control-untagged", "Base", "", "super(untagged)"},
		{"control-local", "Base", "", "super(() => 1)"},
		{"control-caught-call", "Base", "", "try { super(risky) } catch { super(safe) }"},
		{"control-caught-literal", "Base", "", "super(() => { try { return risky() } catch { return 1 } })"},
		{"nested-source", "Base", "", "super(() => { const nested = () => ⟦risky()⟧; return 1 })"},
	} {
		add(&failCase{Name: "super-rethrows-" + row.name, Owner: "compiler", Quote: superRethrowsRule, Code: 401, Host: "none", Lib: superRethrowsLib, Decls: row.prefix + "export class Derived extends " + row.base + " { constructor() { " + row.body + " } }"})
	}

	const signatures = "Tags attach to call signatures: each overload and a returned callable's own signature carry their own. `const g = f` preserves `f`'s contract; a tag on an alias of a function type does not attach, so in a foreign declaration write `type Reader = { /** @throws {E} */ (): string }`."
	add(&failCase{Name: "inferred-callable-alias", Quote: signatures, Code: 403, Decls: failParse + "\nconst alias = parse", Body: "⟦alias(s)⟧"})
	add(&failCase{Name: "foreign-callable-alias", Quote: signatures, Code: 403, Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string", Decls: "const alias = parse", Body: "⟦alias(s)⟧"})
	add(&failCase{Name: "alias-declaration-tag-not-admitted", Quote: signatures, Code: 402, Host: "plain", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n" + "/** @throws {Error} */\nexport type Reader = (s: string) => string\n", Body: "⟦const reader: Reader = parse⟧"})
	const rethrow = "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |"
	add(&failCase{Name: "rethrows-multiple-parameters", Quote: rethrow, Code: 403, Decls: failParse, Lib: "/** @throws {never} @rethrows f @rethrows g */\nexport declare function both(f: () => string, g: () => string): string", Body: "⟦both(() => s, () => parse(s))⟧"})
	add(&failCase{Name: "rethrows-foreign-own-unknown", Quote: rethrow, Code: 403, Lib: "/** @rethrows f */\nexport declare function invoke(f: () => string): string", Body: "⟦invoke(() => s)⟧"})
	add(&failCase{Name: "rethrows-own-never-callback-error", Quote: rethrow, Code: 403, Decls: failParse, Lib: "/** @throws {never} @rethrows f */\nexport declare function invoke(f: () => string): string", Body: "⟦invoke(() => parse(s))⟧"})
	const assign = "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything."
	add(&failCase{Name: "assign-incompatible-contract", Quote: assign, Code: 402, Host: "plain", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n" + "export type Reader = { /** @throws {number} */ (s: string): string }\n", Body: "⟦const reader: Reader = parse⟧"})
	add(&failCase{Name: "effectful-error-value-throw", Quote: effectfulBody, Code: 401, Host: "none", Decls: "error Missing\nexport function missing(): Missing { ⟦throw new Error(\"bad\")⟧ }"})
	// Calls through any throw unknown, and so does a new expression whose
	// constructor is typed any: it has no signature, but it is not a class
	// that declares no constructor.
	const throughAny = "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives."
	const anyLib = "export declare const Dynamic: any\n"
	add(&failCase{Name: "new-through-any", Owner: "compiler", Quote: throughAny, Code: 403, Lib: anyLib, Body: "const v = ⟦new Dynamic()⟧"})
	add(&failCase{Name: "new-through-any-argument", Owner: "compiler", Quote: throughAny, Code: 403, Lib: anyLib, Body: "const v = ⟦new Dynamic(s)⟧"})
	add(&failCase{Name: "new-through-any-effectful-plain", Owner: "compiler", Quote: effectfulBody, Code: 401, Host: "none", Lib: anyLib, Decls: "export function probe(): Effect.Effect<number> { ⟦new Dynamic()⟧; return Effect.succeed(1) }"})
	add(&failCase{Name: "new-through-any-control-plain", Owner: "compiler", Quote: throughAny, Host: "plain", Lib: anyLib, Body: "const v = new Dynamic()"})
	add(&failCase{Name: "new-through-any-control-bridge", Owner: "compiler", Quote: throughAny, Lib: anyLib, Body: "const v = try Effect.orDie(Effect.try(() => new Dynamic()))"})
	add(&failCase{Name: "new-through-any-control-local-class", Owner: "compiler", Quote: throughAny, Decls: "class Local { value = 1 }", Body: "const v = new Local()"})
	// An interface named Effect that copies the `~effect/Effect` marker but
	// declares no A, E and R parameters is not assignable to Effect.Effect, so
	// its callers are ordinary calls with their written contracts. Checking
	// any such call once crashed the compiler.
	const effectCopies = "import type { Effect as Native } from \"effect\"\ninterface Effect { readonly \"~effect/Effect\": Native.Effect<number>[\"~effect/Effect\"] }\nexport declare function copy(): Effect\n/** @throws {RangeError} */\nexport declare function knownCopy(): Effect\n/** @throws {never} */\nexport declare function safeCopy(): Effect\nexport declare function whole(): Native.Effect<number>\n"
	for _, call := range []struct{ name, expr string }{{"untagged", "copy()"}, {"known", "knownCopy()"}} {
		add(&failCase{Name: "effect-interface-copy-" + call.name, Owner: "compiler", Quote: effectful, Code: 403, Lib: effectCopies, Body: "const value = ⟦" + call.expr + "⟧"})
	}
	for _, call := range []struct{ name, expr string }{{"never", "safeCopy()"}, {"whole", "whole()"}, {"bridge", "try Effect.orDie(Effect.try(() => copy()))"}} {
		add(&failCase{Name: "effect-interface-copy-control-" + call.name, Owner: "compiler", Quote: effectful, Lib: effectCopies, Body: "const value = " + call.expr})
	}
	add(&failCase{Name: "effect-interface-copy-control-plain", Owner: "compiler", Quote: effectful, Host: "plain", Lib: effectCopies, Body: "const value = copy()"})
	add(&failCase{Name: "effect-interface-copy-control-top", Owner: "compiler", Quote: effectful, Host: "none", Lib: effectCopies, Decls: "export const value = copy()"})
	add(&failCase{Name: "effect-interface-copy-control-return", Owner: "compiler", Quote: effectful, Host: "none", Lib: effectCopies, Decls: "export function probe(): ReturnType<typeof copy> { return copy() }"})
	// A class override is checked like an implemented member: a member a
	// class declares over a base class member must admit no throw the base
	// member's function type does not.
	const overrides = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`, with `service` members as interface members."
	const overrideLib = "export declare class Reader { read: () => string }\nexport declare class Source { read(): string }\nexport declare class Tolerant {\n  /** @throws {Error} */\n  read(): string\n}\nexport declare class Box<T> { read: () => T }\nexport declare class Statics { static read: () => string }\n/** @throws {RangeError} */\nexport declare function parse(): string\n/** @throws {never} */\nexport declare function safe(): string\nexport declare function untagged(): string\n"
	for _, row := range []struct{ name, decls string }{
		{"known", "export class C extends Reader { ⟦read⟧ = parse }"},
		{"untagged", "export class C extends Reader { ⟦read⟧ = untagged }"},
		{"over-method", "export class C extends Source { ⟦read⟧ = parse }"},
		{"local-base", "class Local { read = (): string => \"local\" }\nexport class C extends Local { ⟦read⟧ = parse }"},
		{"expression", "export const C = class extends Reader { ⟦read⟧ = parse }"},
		{"generic-base", "export class C extends Box<string> { ⟦read⟧ = parse }"},
		{"static", "export class C extends Statics { static ⟦read⟧ = parse }"},
		{"static-untagged", "export class C extends Statics { static ⟦read⟧ = untagged }"},
	} {
		add(&failCase{Name: "class-override-" + row.name, Owner: "compiler", Quote: overrides, Code: 402, Host: "none", Lib: overrideLib, Decls: row.decls})
	}
	for _, row := range []struct{ name, decls string }{
		{"admitted", "export class C extends Tolerant { read = parse }"},
		{"never", "export class C extends Reader { read = safe }"},
		{"static-never", "export class C extends Statics { static read = safe }"},
		{"inherited", "export class C extends Reader {}"},
		{"method", "export class C extends Source { override read(): string { return \"method\" } }"},
	} {
		add(&failCase{Name: "class-override-control-" + row.name, Owner: "compiler", Quote: overrides, Host: "none", Lib: overrideLib, Decls: row.decls})
	}
	// A @throws tag that writes no type, with no braces or with empty ones,
	// names no thrown type: its callee keeps the untagged contract, unknown.
	const noTag = "| no tag | `unknown` |"
	for _, tag := range []struct{ name, doc string }{{"empty-braces", "/** @throws {} */"}, {"spaced-braces", "/** @throws { } */"}, {"bare", "/** @throws */"}, {"prose", "/** @throws if the input is empty */"}} {
		lib := tag.doc + "\nexport declare function f(): number\n"
		add(&failCase{Name: "throws-untyped-" + tag.name, Owner: "compiler", Quote: noTag, Code: 403, Lib: lib, Body: "const v = ⟦f()⟧"})
		add(&failCase{Name: "throws-untyped-" + tag.name + "-assign", Owner: "compiler", Quote: noTag, Code: 402, Host: "plain", Lib: lib, Body: "const r: () => number = ⟦f⟧"})
		add(&failCase{Name: "throws-untyped-control-" + tag.name + "-plain", Owner: "compiler", Quote: noTag, Host: "plain", Lib: lib, Body: "const v = f()"})
	}
	return append(cases, failuresRound20Cases()...)
}
