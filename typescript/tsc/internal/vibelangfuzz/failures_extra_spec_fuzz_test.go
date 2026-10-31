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
	const effectful = "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. For example, in Effect 4.1.0 this includes `Exit` values, `Config` programs, `error` instances, service keys and references; this is not an exhaustive list. A plain function whose return type is wholly one of these Effect subtypes is effectful and may not throw: `function bad(): Exit.Exit<number> { throw \"x\" }` is `EK0401`. `Stream` and `Layer` have their separate effectful-return categories above; neither they nor `Fiber` pass the Effect execution operand test. An effectful callable's thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists."
	const effectfulBody = "In a plain `.vibe` function whose return type is an Effect, a `Stream` or a `Layer`, an uncaught `throw` in its own body (nested functions excluded), or an unwrapped call or class evaluation whose thrown type is not `never`, is an error (`EK0401`): make it an `effect` function, or return `fail(e)`."
	add(&failCase{Name: "effectful-service-key", Quote: effectful, Decls: "service Store { value: number }\nfunction key() { return Store }", Body: "const value = key()"})
	add(&failCase{Name: "effectful-service-reference", Quote: effectful, Decls: "service Store {\n static readonly defaultValue = () => ({ value: 1 })\n value: number\n}\nfunction key() { return Store }", Body: "const value = key()"})
	add(&failCase{Name: "effectful-service-member", Quote: "a service member typed as an Effect", Lib: "import { Effect } from \"effect\"\nexport declare const store: { load(): Effect.Effect<number> }", Body: "const value = store.load()"})
	for _, decl := range []struct{ name, body string }{
		{"key", "service Store { value: number }"},
		{"reference", "service Store {\n static readonly defaultValue = () => ({ value: 1 })\n value: number\n}"},
	} {
		add(&failCase{Name: "effectful-service-" + decl.name + "-throw", Quote: effectfulBody, Code: 401, Host: "none", Decls: decl.body + "\nexport function key(): typeof Store { ⟦throw new Error(\"bad\")⟧; return Store }"})
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

	const wrapperRule = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`). VIP-4's two wrappers declare their thunk parameter `@throws {unknown}` ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)), in both overloads: the function argument or the options object's `try` property. Thus `Effect.try(() => parse(s))` and `tryPromise(() => queryDb(q))` are allowed, and the wrapper turns a throw into a failure. The options object's `catch` callback has the ordinary non-throwing function type; a tracked throw there is rejected, while an implicit throw is a defect. Effect's `LazyArg` and other callback parameter types, including those in `.d.ts` files, describe what an argument callback may throw; without `@throws`, they admit only `never`. This admission rule does not change the foreign-callable default: calling an unannotated foreign function-typed property still throws `unknown`. Every other function parameter admits only what its type says: `sync(() => parse(s))` is an error, so wrap the call with `Effect.try`."
	add(&failCase{Name: "wrapper-callback-throw", Quote: wrapperRule, Code: 402, Decls: failParse, Body: "const p = Effect.callback<number>(⟦() => { parse(s) }⟧)"})
	add(&failCase{Name: "wrapper-suspend-throw", Quote: effectfulBody, Code: 401, Decls: failParse, Body: "const p = Effect.suspend(() => { ⟦parse(s)⟧; return Effect.succeed(1) })"})
	const direct = "| In effect code or a plain `catch` handler's parameter/default/destructuring initialization or body, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |"
	add(&failCase{Name: "catch-tracked-new", Quote: direct, Code: 403, Decls: failInput, Body: "const p = Effect.fail(\"bad\") catch () => ⟦new Input(s)⟧"})
	add(&failCase{Name: "catch-tracked-template", Quote: direct, Code: 403, Decls: "function tag(parts: TemplateStringsArray) { throw new Error(parts[0]) }", Body: "const p = Effect.fail(\"bad\") catch () => ⟦tag`x`⟧"})
	const producing = "| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |"
	add(&failCase{Name: "promise-new", Quote: producing, Code: 404, Body: "const p = ⟦new Promise<number>((resolve) => resolve(1))⟧"})

	const signatures = "`@throws {T}` and `@rethrows p` attach to call signatures, not a `type` alias's declaration: write `type Reader = { /** @throws {Error} */ (): string }`. Contracts travel with signatures: `const g = f` preserves `f`'s thrown type."
	add(&failCase{Name: "inferred-callable-alias", Quote: signatures, Code: 403, Decls: failParse + "\nconst alias = parse", Body: "⟦alias(s)⟧"})
	add(&failCase{Name: "foreign-callable-alias", Quote: signatures, Code: 403, Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string", Decls: "const alias = parse", Body: "⟦alias(s)⟧"})
	add(&failCase{Name: "alias-declaration-tag-ignored", Quote: signatures, Decls: "/** @throws {Error} */\ntype Reader = () => string\nfunction read(f: Reader) { return f() }", Body: "read(() => s)"})
	add(&failCase{Name: "alias-declaration-tag-not-admitted", Quote: signatures, Code: 402, Host: "plain", Decls: failParse + "\n/** @throws {Error} */\ntype Reader = (s: string) => string", Body: "⟦const reader: Reader = parse⟧"})
	const rethrow = "3. **Rethrows for synchronous callables:** union the own thrown type with the thrown types of the actual callbacks passed for every named `@rethrows` parameter, whichever case in step 2 applied. The tag is written, never inferred. `@throws {never}` describes only the callee's own throws and does not erase `@rethrows f`. Argument-expression evaluation remains the caller's code."
	add(&failCase{Name: "rethrows-multiple-parameters", Quote: rethrow, Code: 403, Decls: failParse, Lib: "/** @throws {never} @rethrows f @rethrows g */\nexport declare function both(f: () => string, g: () => string): string", Body: "⟦both(() => s, () => parse(s))⟧"})
	add(&failCase{Name: "rethrows-foreign-own-unknown", Quote: rethrow, Code: 403, Lib: "/** @rethrows f */\nexport declare function invoke(f: () => string): string", Body: "⟦invoke(() => s)⟧"})
	add(&failCase{Name: "rethrows-own-never-callback-error", Quote: rethrow, Code: 403, Decls: failParse, Lib: "/** @throws {never} @rethrows f */\nexport declare function invoke(f: () => string): string", Body: "⟦invoke(() => parse(s))⟧"})
	const assign = "a function whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything."
	add(&failCase{Name: "assign-incompatible-contract", Quote: assign, Code: 402, Host: "plain", Decls: failParse + "\ntype Reader = { /** @throws {number} */ (s: string): string }", Body: "⟦const reader: Reader = parse⟧"})
	add(&failCase{Name: "effectful-error-value-throw", Quote: effectfulBody, Code: 401, Host: "none", Decls: "error Missing\nexport function missing(): Missing { ⟦throw new Error(\"bad\")⟧ }"})
	return append(cases, failuresRound20Cases()...)
}
