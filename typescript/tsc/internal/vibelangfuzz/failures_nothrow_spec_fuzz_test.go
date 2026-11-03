package vibelangfuzz

import "strings"

// VIP-4 and VIP-5, amended 2026-10-31 (Will: "Plain functions are not allowed
// to throw I have said this about 15 times", and "If you throw in vibelang
// itself in a sync function that's an error"): synchronous VibeLang code
// outside effect code never throws, and only callables declared in `.ts`,
// `.d.ts` and JavaScript carry thrown types. These are the chapter's words;
// TestFailuresSpecQuotes checks each one is still there.
var nothrowQ = struct{ plainRow, asyncRow, constructs, throwStmt, knownCall, literal, tryStmt, step1, step2, async, propagate, effectfulBody, effectfulBodyShort, directRow, noInference, section, instance, static, thunks, nested, service, where, tag, tagTs, handler, overload, method, tsRow, declThrows, noRethrows string }{
	plainRow:           "| any other `.vibe` code | a compile error, `EK0401` ([Plain code never throws](#plain-code-never-throws)) |",
	asyncRow:           "| an `async` function, arrow or method, its parameter list included, or an `async` generator's body | JavaScript's `throw`: the returned Promise rejects with `e` (decided detail 251) |",
	constructs:         "plain function declarations, function expressions and arrows (one nested in effect code included), plain methods, constructors, getters and setters, plain generators (`function*` and `*m()`), class field initializers, `static` field initializers and `static` blocks, every function's parameter list",
	throwStmt:          "- A `throw` statement is `EK0401`, whether or not a `try` statement in the same function catches it.",
	knownCall:          "- A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement that has a `catch` clause, in the same function: the `catch` clause catches everything, so the throw can't leave the function. A call in the `catch` or `finally` block, or in a `try` statement with only `finally`, is the error. The check is syntactic. Its callee has a written or shipped `@throws {T}` other than `@throws {never}` (`@throws {unknown}` included), or a `@rethrows` parameter given a callback known to throw. A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call. A plain function whose return type is wholly effectful, and an effectful function's parameter list, keep the stricter rule of [Effectful callables](#effectful-callables): any thrown type other than `never` is `EK0401`.",
	literal:            "- A function literal passed where the parameter's function type admits throws (`@throws {T}` on its call signature, as the thunks of `Effect.try` and `Effect.tryPromise` and the `Promise` executor have, [Assignability](#assignability)), or as the argument of a `@rethrows` parameter, may contain calls known to throw: they belong to the enclosing call, which is checked where it sits. A function nested in such a literal, whether it is returned, stored, passed on or called in place, is its own plain code and keeps this check: a returned callback runs after the call has finished. A `throw` statement in such a literal is still `EK0401`.",
	tryStmt:            "- TypeScript's `try { } catch { }` statement stays allowed in plain code; it catches implicit throws, calls whose throwing is unknown and calls known to throw.",
	step1:              "1. **Effectful or VibeLang callee:** an effectful callee's thrown type is `never`; neither `@throws` nor `@rethrows` adds synchronous throws. Every callable declared in `.vibe`, `async` ones included, also has thrown type `never`: its synchronous code can't throw, and an `async` callable's throws reject its Promise, as [Async contracts](#async-contracts) specifies (VIP-4, amended 2026-10-31).",
	step2:              "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (in `.ts`, `.d.ts` and JavaScript; in `.vibe` the tag is `EK0406`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
	async:              "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
	propagate:          "Synchronous VibeLang code outside effect code never throws, and an `async` function turns a `throw` into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.",
	effectfulBody:      "Because an effectful function can't throw, its own code that runs before the Effect exists may not throw either. In a plain `.vibe` function whose return type is an Effect, a `Stream` or a `Layer`, a `throw` is `EK0401`, as in all [plain code](#plain-code-never-throws), and so is an unwrapped call or class evaluation whose thrown type is not `never`, `unknown` included: make it an `effect` function, or return `fail(e)`. This follows VIP-4's effectful-callable amendment; its 2026-10-31 amendment extends the `throw` rule to all synchronous code outside effect code. The same holds for code an `effect` function runs at the call ([Code outside the generator](#code-outside-the-generator)).",
	effectfulBodyShort: "In a plain `.vibe` function whose return type is an Effect, a `Stream` or a `Layer`, a `throw` is `EK0401`",
	directRow:          "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))`. In a plain `catch` handler and other plain code, a call known to throw is `EK0401` ([Plain code never throws](#plain-code-never-throws)) | `EK0403` |",
	noInference:        "A `.vibe` function has no inferred thrown type, recursive or not",
	section:            "This section is the one definition of throw tracking; every other chapter refers to it. Every call, `new` expression, tagged template and class declaration or expression has a *thrown type*: what it may throw synchronously, or `never`. Tracking applies only to non-effectful callables (VIP-4, amended: \"an effectful function literally cannot throw\")",
	instance:           "- **Instance field initializers** run in `new X()`. They are synchronous code outside effect code: a `throw` or a call known to throw there is `EK0401`, and a `.vibe` constructor's thrown type stays `never`.",
	static:             "- **Static blocks and static field initializers** run when the class is evaluated, including inside a generator. They are synchronous code outside effect code: a `throw` or a call known to throw there is `EK0401`, and a `.vibe` class evaluation has thrown type `never`. These initializers are not effect code; `try` cannot run an Effect there.",
	thunks:             "- **Wrapper thunks** run inside the Effect: what their calls throw becomes what the wrapper makes of it. A `throw` statement in a `.vibe` thunk is still `EK0401`.",
	nested:             "A function nested in such a literal, whether it is returned, stored, passed on or called in place, is its own plain code and keeps this check: a returned callback runs after the call has finished.",
	service:            "A `service` member is an interface member for throw tracking (detail 3): without `@throws` it admits only `never`. An implementation written in `.vibe` can't throw (`EK0401` at its `throw`); a foreign member value known to throw is `EK0402`.",
	where:              "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`).",
	tag:                "Any `@throws` or `@rethrows` tag in a `.vibe` file is `EK0406`: remove the tag.",
	tagTs:              "Such tags on effectful callables in `.ts`, `.d.ts` and JavaScript are ignored.",
	handler:            "in a plain `catch` handler's eager parameters or body is `EK0401`, including defaults, destructuring and computed binding keys",
	overload:           "A local `.vibe` implementation has thrown type `never`, so it satisfies every exposed overload bound; a `throw` or a call known to throw in it is `EK0401` at that site.",
	method:             "A method written in `.vibe` can't throw at all, so its `throw` is `EK0401`; `EK0402` applies to foreign function values.",
	tsRow:              "| a `.ts` or JavaScript file | JavaScript's `throw`; callers see it through `@throws` ([Thrown types](#thrown-types)) |",
	declThrows:         "- **Thrown types.** Every callable declared in `.vibe` has thrown type `never` ([Thrown types](003-failures.md#thrown-types); VIP-4, amended 2026-10-31: synchronous VibeLang code never throws). An effectful function carries no `@throws`. Every other call signature the output emits carries `@throws {never}`, so a TypeScript reader doesn't fall back to the foreign default `unknown`: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias. A bare function type (`() => string`) stays a function type. Getters and setters carry none.",
	noRethrows:         "- **No `@rethrows` is emitted.** A `.vibe` file can't write `@throws` or `@rethrows` (`EK0406`), and nothing is inferred, so the output writes no `@rethrows`. A `.vibe` function's callback parameter admits only what its type says: a function type in `.vibe` admits only `never`.",
}

// foreignFixtures moves the cases' shared throwing callees out of `.vibe`.
// A `.vibe` function that throws is itself `EK0401` now, so a case that needs
// a callee known to throw declares it in lib.ts or lib.d.ts with `@throws`,
// the only place such a contract can come from (chapter 3, step 2).
func foreignFixtures(cases []*failCase) []*failCase {
	fixtures := []struct{ vibe, lib string }{
		{failInput, "export declare class Input {\n  readonly text: string\n  /** @throws {Error} */\n  constructor(text: string)\n  get value(): string\n}\n"},
		{failInvoke, "/** @throws {never} @rethrows callback */\nexport declare function invoke(callback: () => string): string\n"},
		{failParse, "/** @throws {Error} */\nexport declare function parse(s: string): string\n"},
		{"function tag(parts: TemplateStringsArray) { throw new Error(\"bad\") }", "/** @throws {Error} */\nexport declare function tag(parts: TemplateStringsArray): never\n"},
		{"function boom(): never { throw new Error(\"bad\") }", "/** @throws {Error} */\nexport declare function boom(): never\n"},
		{"function bad(s: string) { throw new Error(s) }", "/** @throws {Error} */\nexport declare function bad(s: string): never\n"},
		{"function uncertain(s: string): Effect.Effect<number> | undefined { if (!s) throw new Error(\"empty\"); return undefined }", "import { Effect } from \"effect\"\n/** @throws {Error} */\nexport declare function uncertain(s: string): Effect.Effect<number> | undefined\n"},
		{"function uncertain(s: string): any { if (!s) throw new Error(\"empty\"); return 1 }", "/** @throws {Error} */\nexport declare function uncertain(s: string): any\n"},
		{"function uncertain(s: string): unknown { if (!s) throw new Error(\"bad\"); return 1 }", "/** @throws {Error} */\nexport declare function uncertain(s: string): unknown\n"},
	}
	for _, c := range cases {
		for _, f := range fixtures {
			if strings.Contains(c.Decls, f.vibe) {
				c.Decls = strings.Trim(strings.Replace(c.Decls, f.vibe, "", 1), "\n")
				c.Lib = f.lib + c.Lib
			}
		}
	}
	return cases
}

// failuresNoThrowCases checks "Plain code never throws" construct by
// construct, and the `try` block exception for calls (spec agent correction,
// 2026-10-31: a known-throwing call can't leave a `try` block that has a
// `catch` clause; a `throw` statement is always the error).
func failuresNoThrowCases() []*failCase {
	var cases []*failCase
	add := func(c *failCase) {
		c.Owner, c.VIP = "nothrow-impl", 4
		cases = append(cases, c)
	}
	const parse = "/** @throws {Error} */\nexport declare function parse(s: string): string\n"
	const plain = "export declare function plain(s: string): string\n"
	q := nothrowQ
	// throw statements, in a try or not
	add(&failCase{Name: "nothrow-throw-caught", Quote: q.throwStmt, Host: "plain", Body: "try { if (!s) ⟦throw new Error(\"empty\")⟧ } catch { }", Code: 401})
	add(&failCase{Name: "nothrow-rethrow-in-catch", Quote: q.throwStmt, Host: "plain", Lib: parse, Body: "try { parse(s) } catch (e) { ⟦throw e⟧ }", Code: 401})
	add(&failCase{Name: "nothrow-recursive-throw", Quote: q.throwStmt, Host: "none", Decls: "export function walk(n: number): void { if (n) walk(n - 1); else ⟦throw new Error(\"end\")⟧ }", Code: 401})
	// calls known to throw, and the try block
	add(&failCase{Name: "nothrow-known-call", Quote: q.knownCall, Host: "plain", Lib: parse, Body: "const v = ⟦parse(s)⟧", Code: 401})
	add(&failCase{Name: "nothrow-json-parse", Quote: q.knownCall, Host: "plain", Body: "const v: unknown = ⟦JSON.parse(s)⟧", Code: 401})
	add(&failCase{Name: "nothrow-known-call-try", Quote: q.knownCall, Host: "plain", Lib: parse, Body: "try { parse(s) } catch { }"})
	add(&failCase{Name: "nothrow-json-parse-try", Quote: q.knownCall, Host: "none", Decls: "export function orNull(s: string) { try { return JSON.parse(s) } catch { return null } }"})
	add(&failCase{Name: "nothrow-known-call-catch-block", Quote: q.knownCall, Host: "plain", Lib: parse, Body: "try { s.trim() } catch { ⟦parse(s)⟧ }", Code: 401})
	add(&failCase{Name: "nothrow-known-call-finally-block", Quote: q.knownCall, Host: "plain", Lib: parse, Body: "try { s.trim() } finally { ⟦parse(s)⟧ }", Code: 401})
	add(&failCase{Name: "nothrow-known-call-try-finally-only", Quote: q.knownCall, Host: "plain", Lib: parse, Body: "try { ⟦parse(s)⟧ } finally { }", Code: 401})
	add(&failCase{Name: "nothrow-known-call-nested-in-try", Quote: q.knownCall, Host: "plain", Lib: parse, Body: "try { const f = () => ⟦parse(s)⟧ } catch { }", Code: 401})
	add(&failCase{Name: "nothrow-unknown-call", Quote: q.knownCall, Host: "plain", Lib: plain, Body: "plain(s)"})
	add(&failCase{Name: "nothrow-try-statement", Quote: q.tryStmt, Host: "plain", Lib: plain, Body: "try { plain(s) } catch { }"})
	add(&failCase{Name: "nothrow-handler-try", Quote: q.handler, Host: "effect", Lib: parse, Body: "return Effect.fail(new Error(\"input\")) catch (e) => { try { return parse(s) } catch { return \"\" } }"})
	// function literals the parameter admits
	add(&failCase{Name: "nothrow-wrapper-thunk-plain", Quote: q.literal, Host: "plain", Lib: parse, Body: "const e = Effect.try(() => parse(s))"})
	add(&failCase{Name: "nothrow-wrapper-thunk-throw", Quote: q.literal, Host: "effect", Body: "const v = try Effect.try(() => { ⟦throw new Error(\"x\")⟧ })", Code: 401})
	add(&failCase{Name: "nothrow-wrapper-thunk-wrapped", Quote: q.literal, Host: "effect", Lib: parse, Body: "return try Effect.fail(new Error(\"input\")) catch effect (e) => try Effect.try(() => parse(s))"})
	add(&failCase{Name: "nothrow-rethrows-effectful-callee", Quote: q.literal, Host: "effect", Lib: "import { Effect } from \"effect\"\ntype Callback = {\n /** @throws {unknown} */\n (): number\n}\n/** @throws {Error} @rethrows callback */\nexport declare function load(callback: Callback): Effect.Effect<number>", Body: "const value = load(() => JSON.parse(s))"})
	// each construct of synchronous code outside effect code
	add(&failCase{Name: "nothrow-arrow", Quote: q.constructs, Host: "none", Decls: "export const check = (s: string) => { if (!s) ⟦throw new Error(\"empty\")⟧; return s }", Code: 401})
	add(&failCase{Name: "nothrow-arrow-in-effect", Quote: q.constructs, Host: "effect", Body: "const f = () => { ⟦throw new Error(\"x\")⟧ }", Code: 401})
	add(&failCase{Name: "nothrow-method", Quote: q.constructs, Host: "none", Decls: "export class Box { m() { ⟦throw new Error(\"x\")⟧ } }", Code: 401})
	add(&failCase{Name: "nothrow-object-method", Quote: q.constructs, Host: "none", Decls: "export const o = { m() { ⟦throw new Error(\"x\")⟧ } }", Code: 401})
	add(&failCase{Name: "nothrow-constructor", Quote: q.constructs, Host: "none", Decls: "export class Box { constructor(n: number) { if (n < 0) ⟦throw new RangeError(\"n\")⟧ } }", Code: 401})
	add(&failCase{Name: "nothrow-getter", Quote: q.constructs, Host: "none", Decls: "export class Box { get v(): number { ⟦throw new Error(\"x\")⟧ } }", Code: 401})
	add(&failCase{Name: "nothrow-setter", Quote: q.constructs, Host: "none", Decls: "export class Box { set v(n: number) { ⟦throw new Error(\"x\")⟧ } }", Code: 401})
	add(&failCase{Name: "nothrow-generator", Quote: q.constructs, Host: "none", Decls: "export function* gen() { ⟦throw new Error(\"x\")⟧ }", Code: 401})
	add(&failCase{Name: "nothrow-static-block", Quote: q.static, Host: "none", Decls: "export class Box { static { ⟦throw new Error(\"x\")⟧ } }", Code: 401})
	add(&failCase{Name: "nothrow-field-initializer", Quote: q.instance, Host: "none", Lib: parse, Decls: "export class Box { v = ⟦parse(\"x\")⟧ }", Code: 401})
	add(&failCase{Name: "nothrow-async-known-call", Quote: q.asyncRow, Host: "async", Lib: parse, Body: "parse(s)"})
	add(&failCase{Name: "nothrow-effect-calls-vibe", Quote: q.step1, Decls: "function check(s: string) { return s.length }", Body: "const n = check(s)"})
	// @throws and @rethrows belong to TypeScript and JavaScript
	add(&failCase{Name: "nothrow-throws-tag", Quote: q.tag, Host: "none", Decls: "⟦/** @throws {Error} */\nexport function parse(s: string) { return s }⟧", Code: 406})
	add(&failCase{Name: "nothrow-rethrows-tag", Quote: q.tag, Host: "none", Decls: "⟦/** @rethrows f */\nexport function each(f: () => void) { f() }⟧", Code: 406})
	add(&failCase{Name: "nothrow-type-throws-tag", Quote: q.tag, Host: "none", Decls: "⟦export type Reader = {\n  /** @throws {Error} */\n  (): string\n}⟧", Code: 406})
	add(&failCase{Name: "nothrow-declaration-no-rethrows", Chapter: "001-functions.md", Quote: q.noRethrows, Host: "none", Decls: "export function each(xs: string[], f: (s: string) => void) { xs.forEach(f) }", Throws: map[string]string{"each": "{never}"}})
	return cases
}
