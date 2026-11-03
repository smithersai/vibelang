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
	asyncRow:           "| an `async` function, arrow or method, its parameter list included, an `async` generator's body, or an `async match` | JavaScript's `throw`: the returned Promise rejects with `e` |",
	constructs:         "plain functions and arrows (one nested in effect code included), plain methods, constructors, accessors, plain generators, class field initializers, `static` blocks, every parameter list except an ordinary `async` function's, plain `catch` handlers (parameters and body), and the module top level",
	throwStmt:          "- A `throw` statement is `EK0401`, even when a `try` statement in the same function catches it.",
	knownCall:          "- A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function.",
	literal:            "as the thunks of `Effect.try` and `Effect.tryPromise` and the `Promise` executor do, or passed to a `@rethrows` parameter, may contain calls known to throw: they belong to the enclosing call.",
	tryStmt:            "- TypeScript's `try { } catch { }` statement stays allowed.",
	step1:              "A callable declared in VibeLang (`.vibe` or `.vibex`, outside a `module` body) has thrown type `never`. Nothing is inferred from a body.",
	step2:              "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
	async:              "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
	propagate:          "Effect code calls a function whose thrown type is `never` directly.",
	effectfulBody:      "- A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`",
	effectfulBodyShort: "A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter",
	directRow:          "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
	noInference:        "Nothing is inferred from a body.",
	section:            "This section is the one definition of throw tracking; every other chapter refers to it.",
	instance:           "- **Field initializers and static blocks** run in `new X()` and at class evaluation; a non-`never` class evaluation is `EK0403` in effect code and `EK0401` elsewhere.",
	static:             "- **Field initializers and static blocks** run in `new X()` and at class evaluation; a non-`never` class evaluation is `EK0403` in effect code and `EK0401` elsewhere.",
	thunks:             "- **Arguments** are evaluated by the caller. **Wrapper thunks** run inside the Effect.",
	nested:             "A function nested in that literal is its own plain code.",
	service:            "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`, with `service` members as interface members.",
	where:              "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`",
	tag:                "A written `@throws` or `@rethrows` tag there, on a function, service member or function-type signature, is `EK0406`: remove it",
	tagTs:              "A re-exported foreign callable keeps its actual `@throws` and `@rethrows`.",
	handler:            "A call known to throw in a plain `catch` handler's parameters or body is `EK0401`.",
	overload:           "A callable declared in VibeLang (`.vibe` or `.vibex`, outside a `module` body) has thrown type `never`. Nothing is inferred from a body.",
	method:             "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`",
	tsRow:              "| a `.ts` or JavaScript file, or a `module` body (VIP-40) | JavaScript's `throw`; callers see it through `@throws` ([Thrown types](#thrown-types)) |",
	declThrows:         "- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one",
	noRethrows:         "A re-exported foreign callable keeps its actual `@throws` and `@rethrows`.",
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
