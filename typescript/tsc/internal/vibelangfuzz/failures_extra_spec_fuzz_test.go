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
	return append(cases, failuresRound20Cases()...)
}
