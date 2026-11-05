// 003-failures.md: TestFailuresSpec/plain/error declaration-member matrix and schema-error declaration-member matrix
// rule: docs/design/src/003-failures.md#bc5d8bfb778877ab
// 003-failures.md: TestFailuresSpec/error-interleaved + error-empty-elements + schema-error-empty-elements and rejected-member witnesses
// rule: docs/design/src/003-failures.md#5c28b6282da69cf8
// 003-failures.md: TestFailuresSpec/throws-upper-bound + throws-upper-bound-ok checks acceptance, rejection or emitted throws
// rule: docs/design/src/003-failures.md#b7dd9f8559a5ef6d
// 003-failures.md: TestFailuresSpec/rethrows-promise-executor checks acceptance, rejection or emitted throws
// rule: docs/design/src/003-failures.md#492e345d6999a6f4
// 003-failures.md: TestFailuresSpec/rethrows-promise-executor checks acceptance, rejection or emitted throws
// rule: docs/design/src/003-failures.md#e2f62f7221252f53
// 003-failures.md: TestFailuresSpec/library-unannotated + global-json-parse + global-json-parse-wrapped checks acceptance, rejection or emitted throws
// rule: docs/design/src/003-failures.md#4a44f003f72216d2
// 003-failures.md: TestFailuresSpec/rethrows-own-throw + library-unannotated checks acceptance, rejection or emitted throws
// rule: docs/design/src/003-failures.md#43c84068aa93c8ae
// 006-data.md: schema-error-default-export cases require error-form EK1305
// rule: docs/design/src/006-data.md#a9cf713695c4deb2
package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzFailuresSpec checks the static rules of the Failures chapter
// (003-failures.md: throw, calls that may throw, error and schema error
// declarations) and the @throws part of Declaration output
// (001-functions.md). Each case quotes the sentence it checks; the quote
// must still be in its chapter (TestFailuresSpecQuotes), and every bullet
// and static-rule row of the chapter must be quoted by a case or listed in
// failuresNotAsserted with the reason (TestFailuresSpecCoverage), so the
// target fails when the chapter grows.
//
// A rejection requires the chapter's EK code inside the marked span,
// with no error elsewhere (ordinary TypeScript rules use their diagnostics),
// and an acceptance is no error at all. Run-time meaning (what a throw
// fails with) is FuzzVIPDifferential's, not this target's.

const failuresChapter = "003-failures.md"

// A failCase is one program the chapter accepts or rejects. Body is the
// statements of a host function chosen by Host; Decls are top-level
// declarations, which the fuzzer may move to a second module, since a
// function's thrown type is inferred from its body wherever it is declared;
// Lib, when set, is a TypeScript module imported as "./lib.js", which the
// fuzzer writes as lib.ts or lib.d.ts. ⟦…⟧ in Body or Decls marks where a
// rejection must stand; a case with no marker must compile with no error.
// Throws, when set, checks the emitted declarations instead: each name maps
// to the @throws tag its declaration must carry, or "" for none.
type failCase struct {
	Name          string
	Chapter       string // default failuresChapter
	Quote         string
	Owner         string // the lane that implements the rule
	VIP           int
	Host          string // "effect" (default), "plain", "async" or "top"
	Decls         string
	Lib           string
	Body          string
	Code          int   // expected EK diagnostic, zero for ordinary TypeScript errors
	OneDiagnostic bool  // chapter 3 diagnostic precedence
	AlsoCodes     []int // further EK codes the marked span must carry
	NotCodes      []int // EK codes the marked span must not carry
	Throws        map[string]string
}

func (c *failCase) chapter() string {
	if c.Chapter == "" {
		return failuresChapter
	}
	return c.Chapter
}

func (c *failCase) rejects() bool {
	return strings.Contains(c.Body, "⟦") || strings.Contains(c.Decls, "⟦")
}

// Shared declarations, from the chapter's own examples.
const (
	failParse  = "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }"
	failAdd    = "function add(a: number, b: number) { return a + b }"
	failInput  = "class Input {\n  constructor(readonly text: string) { if (!text) throw new Error(\"empty\") }\n  get value() { if (!this.text) throw new Error(\"empty\"); return this.text }\n}"
	failLater  = "async function later(s: string) { if (!s) throw new Error(\"empty\"); return s }"
	failInvoke = "/** @rethrows callback */\nfunction invoke(callback: () => string) { return callback() }"
)

func failuresCases() []*failCase {
	q := struct{ throwEverywhere, jsThrow, effThrow, effectful, never, inferred, async, asyncArgs, library, unknownDefault, neverTag, globals, fnType, differs, newTracked, accessor, rethrows, rethrowGlobals, storing, wrappersStill, effectExports, implicit, decoderBuild, assignable, rethrowWritten, rethrowAccepts, effectfulBody, defaultInit, directCall, promiseCall, plainPropagates, asyncRejects, callsDirectly, wrapIt, promiseReject string }{
		throwEverywhere: "| any other `.vibe` code | a compile error, `EK0401` ([Plain code never throws](#plain-code-never-throws)) |",
		jsThrow:         "| an `async` function, arrow or method, its parameter list included, an `async` generator's body, or an `async match` | JavaScript's `throw`: the returned Promise rejects with `e` |",
		effThrow:        "| effect code | the Effect fails with `e`, a typed error: `return yield* Effect.fail(e)` |",
		effectful:       "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. For example, in Effect 4.1.1 this includes `Exit` values, `Config` programs, `error` instances, service keys and references; this is not an exhaustive list. A plain function whose return type is wholly one of these Effect subtypes is effectful and may not throw: `function bad(): Exit.Exit<number> { throw \"x\" }` is `EK0401`. `Stream` and `Layer` have their separate effectful-return categories above; neither they nor `Fiber` pass the Effect execution operand test. An effectful callable's thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator. Evaluated in a parameter default, before the Effect exists, it throws a JavaScript exception at the call of a plain function, and makes the call of an `effect` function return an Effect that dies with the thrown value, as an `async` function's call returns a rejected Promise ([Functions](001-functions.md#meaning), [Code outside the generator](#code-outside-the-generator)).",
		never:           "A callable declared in VibeLang (`.vibe` or `.vibex`, outside a `module` body) has thrown type `never`. Nothing is inferred from a body.",
		inferred:        "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
		async:           "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
		asyncArgs:       "- **Arguments** are evaluated by the caller.",
		library:         "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
		unknownDefault:  "| no tag | `unknown` |",
		neverTag:        "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
		globals:         "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
		fnType:          "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
		differs:         "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
		accessor:        "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
		newTracked:      "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |",
		rethrows:        "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |",
		rethrowGlobals:  "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
		storing:         "Tags attach to call signatures: each overload and a returned callable's own signature carry their own.",
		wrappersStill:   "Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md).",
		effectExports:   "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.",
		decoderBuild:    "const decode = Schema.decodeUnknownSync(Schema.String) // building the decoder throws never",
		assignable:      "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything.",
		rethrowWritten:  "| `/** @rethrows p */` | its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it |",
		rethrowAccepts:  "A callable whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, `@throws {unknown}` admits anything, and a parameter named by `@rethrows` admits anything.",
		effectfulBody:   "- A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`",
		defaultInit:     "In an effectful function's parameter list a default whose thrown type is not `never` is `EK0401`, and in any other parameter list outside an `async` function a default known to throw is.",
		implicit:        "**Implicit throws.** A throw from receiver or environment state is implicit",
		directCall:      "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
		wrapIt:          "| In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
		promiseCall:     "| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |",
		plainPropagates: "- A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function.",
		asyncRejects:    "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise.",
		callsDirectly:   "Effect code calls a function whose thrown type is `never` directly.",
		promiseReject:   "`Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code.",
	}
	const tracking = "w2-throw"
	var cases []*failCase
	add := func(c *failCase) {
		if c.VIP == 0 {
			c.VIP = 4
			if strings.HasPrefix(c.Name, "error-") {
				c.VIP = 13
			}
			if strings.HasPrefix(c.Name, "schema-error-") {
				c.VIP = 29
			}
		}
		if c.Owner == "" {
			c.Owner = tracking
		}
		if c.rejects() && c.Code == 0 {
			switch {
			case strings.HasPrefix(c.Name, "assign-"), strings.HasPrefix(c.Name, "wrapper-"), c.Name == "rethrows-not-inferred":
				c.Code = 402
			case c.Name == "throws-upper-bound":
				c.Code = 405
			case strings.HasPrefix(c.Name, "effectful-body-"), c.Name == "default-throwing":
				c.Code = 401
			case strings.HasPrefix(c.Name, "error-"), strings.HasPrefix(c.Name, "schema-error-"):
				switch {
				case strings.HasSuffix(c.Name, "-constructor"):
					c.Code = 1301
				case strings.HasSuffix(c.Name, "-tag"), strings.HasSuffix(c.Name, "-extends"):
					c.Code = 2117
				case strings.HasSuffix(c.Name, "-static"), strings.HasSuffix(c.Name, "-setter"):
					c.Code = 1302
				case strings.HasSuffix(c.Name, "-type-parameters"):
					c.Code = 1303
				case strings.Contains(c.Name, "-rejected-"):
					c.Code = 1304
				}
			case strings.HasPrefix(c.Name, "promise-"):
				c.Code = 404
			default:
				c.Code = 403
			}
		}
		cases = append(cases, c)
	}

	// Placement follows VIP-4's no-throw amendment; runtime meaning is the differential's.
	add(&failCase{Name: "throw-effect", Quote: q.effThrow, Body: "if (s.length > 3) throw new Error(\"long\")"})
	add(&failCase{Name: "throw-plain", Owner: "nothrow-impl", Quote: q.throwEverywhere, Host: "plain", Body: "if (s.length > 3) ⟦throw new Error(\"long\")⟧", Code: 401})
	add(&failCase{Name: "throw-async", Quote: q.jsThrow, Host: "async", Body: "if (s.length > 3) throw new Error(\"long\")"})
	add(&failCase{Name: "throw-top", Owner: "nothrow-impl", Quote: q.throwEverywhere, Host: "top", Body: "if (Math.max(1, 2) > 3) ⟦throw new Error(\"never\")⟧", Code: 401})

	// Static rule 1, and its wrapper: the v4 review's circle was a rule that
	// made the chapter's own wrapper an error, so every wrapper shape is here.
	add(&failCase{Name: "direct-local", Quote: q.directCall, Decls: failParse, Body: "⟦parse(s)⟧"})
	add(&failCase{Name: "direct-local-const", Quote: q.directCall, Decls: failParse, Body: "const v = ⟦parse(s)⟧"})
	add(&failCase{Name: "direct-local-argument", Quote: q.directCall, Decls: failParse + "\n" + failAdd, Body: "add(⟦parse(s)⟧.length, 1)"})
	add(&failCase{Name: "direct-local-return", Quote: q.directCall, Decls: failParse, Body: "return ⟦parse(s)⟧"})
	add(&failCase{Name: "wrap-effect-try", Quote: q.wrapIt, Decls: failParse, Body: "const p = try Effect.try(() => parse(s))"})
	add(&failCase{Name: "wrap-effect-try-block", Quote: q.wrapIt, Decls: failParse, Body: "const p = try Effect.try(() => { const t = parse(s); return parse(t) })"})
	add(&failCase{Name: "wrap-effect-try-function", Quote: q.wrapIt, Decls: failParse, Body: "const p = try Effect.try(function () { return parse(s) })"})
	add(&failCase{Name: "wrap-effect-try-options", Quote: q.wrapIt, Decls: failParse, Body: "const p = try Effect.try({ try: () => parse(s), catch: (e) => e })"})
	add(&failCase{Name: "wrap-effect-try-held", Quote: q.wrapIt, Decls: failParse, Body: "const program = Effect.try(() => parse(s))\nconst p = try program"})
	// PREVIEW-5: a callback nested in the thunk is its own plain code
	add(&failCase{Name: "wrap-effect-try-nested-callback", Quote: nothrowQ.nested, Owner: "nothrow-impl", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string", Body: "const p = try Effect.try(() => { const f = (x: number) => ⟦parse(String(x))⟧; return xs.map(f) })", Code: 401})
	add(&failCase{Name: "wrap-effect-try-rethrows-callback", Quote: "may contain calls known to throw: they belong to the enclosing call", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string", Body: "const p = try Effect.try(() => xs.map((x) => parse(String(x))))"})
	add(&failCase{Name: "wrap-try-promise-async", Quote: q.promiseCall, Decls: failLater, Body: "const p = try tryPromise(() => later(s))"})
	add(&failCase{Name: "wrap-promise", Quote: q.promiseCall, Decls: failLater, Body: "const p = try promise(() => later(s))"})
	add(&failCase{Name: "nonthrowing-direct", Quote: q.callsDirectly, Decls: failAdd, Body: "add(1, 2)"})

	// Inference from the body.
	add(&failCase{Name: "inferred-caught", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Decls: failParse + "\nfunction safe(s: string) {\n  try { return parse(s) } catch { return \"\" }\n}", Body: "safe(s)"})
	add(&failCase{Name: "inferred-plain-calls-plain", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Decls: failParse, Body: "⟦parse(s)⟧", Code: 401})
	add(&failCase{Name: "inferred-async-calls-throwing", Quote: q.asyncRejects, Host: "async", Decls: failParse, Body: "parse(s)"})

	// async calls: the call never throws; its arguments may.
	add(&failCase{Name: "async-call-in-plain", Quote: q.async, Decls: failLater + "\nfunction start(s: string) { later(s); return 1 }", Body: "start(s)"})
	add(&failCase{Name: "async-arguments", Owner: "nothrow-impl", Quote: q.asyncArgs, Decls: failParse + "\n" + failLater + "\nfunction start(s: string) { later(⟦parse(s)⟧); return 1 }", Body: "start(s)", Code: 401})

	// Effectful callees are never tracked (decided detail 1).
	add(&failCase{Name: "effectful-ts-effect", Quote: q.effectful, Lib: "import { Effect } from \"effect\"\nexport declare function load(s: string): Effect.Effect<number>", Body: "const n = try load(s)"})
	add(&failCase{Name: "effectful-ts-stream", Quote: q.effectful, Lib: "import { Stream } from \"effect\"\nexport declare function lines(s: string): Stream.Stream<string>", Body: "const t = lines(s)"})
	add(&failCase{Name: "effectful-ts-layer", Quote: q.effectful, Lib: "import { Layer } from \"effect\"\nexport declare function live(): Layer.Layer<never>", Body: "const l = live()"})
	add(&failCase{Name: "effectful-vibe-stream", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`", Decls: "function stream(text: string) { return Stream.succeed(text) }", Body: "const t = stream(s)"})
	add(&failCase{Name: "effectful-vibe-layer", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`", Decls: "function layer() { return Layer.empty }", Body: "const l = layer()"})
	add(&failCase{Name: "effectful-effect-function", Quote: q.effectful, Decls: "effect function inner(s: string) { if (!s) throw new Error(\"empty\"); return s }", Body: "const t = try inner(s)"})
	add(&failCase{Name: "effectful-globals", Quote: q.effectful, Body: "try sleep(\"1 millis\")\nconst n = try sync(() => 1)"})
	add(&failCase{Name: "effectful-no-rethrow", Quote: q.never, Decls: failParse, Body: "const n = try sync(() => 1)\nconst m = try Effect.suspend(() => Effect.succeed(1))"})

	// Library and global functions.
	lib := "export declare function plain(s: string): string\n/** @throws {never} */\nexport declare function safe(s: string): string\n/** @throws {RangeError} */\nexport declare function range(s: string): string\n/** @throws {unknown} */\nexport declare function anything(s: string): string\n"
	add(&failCase{Name: "library-unannotated", Quote: q.unknownDefault, Lib: lib, Body: "⟦plain(s)⟧"})
	add(&failCase{Name: "library-never", Quote: q.neverTag, Lib: lib, Body: "safe(s)"})
	add(&failCase{Name: "library-tagged", Quote: q.library, Lib: lib, Body: "⟦range(s)⟧"})
	add(&failCase{Name: "library-unknown-tag", Quote: q.unknownDefault, Lib: lib, Body: "⟦anything(s)⟧"})
	add(&failCase{Name: "library-tagged-wrapped", Quote: q.wrapIt, Lib: lib, Body: "const v = try Effect.try(() => range(s))"})
	add(&failCase{Name: "library-plain-propagates", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Lib: lib, Body: "⟦range(s)⟧\nplain(s)", Code: 401})
	add(&failCase{Name: "global-json-parse", Quote: "| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |", Body: "const v: unknown = ⟦JSON.parse(s)⟧"})
	add(&failCase{Name: "builtin-bridge-parse-alias", Quote: q.wrapIt, Body: "const parse = JSON.parse; const v = ⟦parse(s)⟧", Code: 403})
	add(&failCase{Name: "builtin-bridge-parse-alias-wrapped", Quote: q.wrapIt, Body: "const parse = JSON.parse; const v = try Effect.try(() => parse(s))", Code: 403})
	add(&failCase{Name: "builtin-bridge-decode-uri", Quote: q.wrapIt, Body: "const v = ⟦decodeURI(s)⟧", Code: 403})
	add(&failCase{Name: "builtin-bridge-decode-uri-wrapped", Quote: q.wrapIt, Body: "const v = try Effect.try(() => decodeURI(s))", Code: 403})
	add(&failCase{Name: "builtin-bridge-decode-component", Quote: q.wrapIt, Body: "const v = ⟦decodeURIComponent(s)⟧", Code: 403})
	add(&failCase{Name: "builtin-bridge-decode-component-wrapped", Quote: q.wrapIt, Body: "const v = try Effect.try(() => decodeURIComponent(s))", Code: 403})
	add(&failCase{Name: "builtin-bridge-bigint", Quote: q.wrapIt, Body: "const v = ⟦BigInt(s)⟧", Code: 403})
	add(&failCase{Name: "builtin-bridge-bigint-wrapped", Quote: q.wrapIt, Body: "const v = try Effect.try(() => BigInt(s))", Code: 403})
	add(&failCase{Name: "builtin-bridge-regexp", Quote: q.wrapIt, Body: "const v = ⟦RegExp(s)⟧", Code: 403})
	add(&failCase{Name: "builtin-bridge-regexp-wrapped", Quote: q.wrapIt, Body: "const v = try Effect.try(() => RegExp(s))", Code: 403})
	add(&failCase{Name: "builtin-bridge-locales", Quote: q.wrapIt, Body: "const v = ⟦Intl.getCanonicalLocales(s)⟧", Code: 403})
	add(&failCase{Name: "builtin-bridge-locales-wrapped", Quote: q.wrapIt, Body: "const v = try Effect.try(() => Intl.getCanonicalLocales(s))", Code: 403})
	add(&failCase{Name: "global-json-parse-wrapped", Quote: "| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |", Body: "const v: unknown = try Effect.try(() => JSON.parse(s))"})
	add(&failCase{Name: "global-math-max", Quote: "| `Math.max(1, 2)` | `never` | call directly |", Body: "const top = Math.max(...xs)"})
	add(&failCase{Name: "effect-option-some", Quote: "| `Option.some(1)` with a written `@throws {never}` contract | `never` | call directly |", Body: "const o = Option.some(s)"})
	add(&failCase{Name: "effect-decode-sync", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const v = ⟦Schema.decodeUnknownSync(Schema.String)(s)⟧"})
	add(&failCase{Name: "effect-decode-sync-wrapped", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const v = try Effect.try(() => Schema.decodeUnknownSync(Schema.String)(s))"})
	add(&failCase{Name: "effect-decoder-build", Quote: "| `Schema.decodeUnknownSync(Schema.String)` or `Schema.decodeSync(Schema.String)` with a written `@throws {never}` contract | `never` | call directly to build the decoder |", Body: "const decode = Schema.decodeUnknownSync(Schema.String)"})
	add(&failCase{Name: "effect-decoder-call", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeUnknownSync(Schema.String)\nconst v = ⟦decode(s)⟧"})
	add(&failCase{Name: "effect-decoder-call-wrapped", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeUnknownSync(Schema.String)\nreturn try Effect.try(() => decode(s))"})

	// Function types and interface members (decided detail 3).
	add(&failCase{Name: "function-type-parameter", Quote: q.fnType, Decls: "function run(f: () => string) { return f() }", Body: "run(() => \"x\")"})
	add(&failCase{Name: "function-type-alias", Quote: q.fnType, Decls: "type Reader = () => string\nfunction run(f: Reader) { return f() }", Body: "run(() => \"x\")"})
	add(&failCase{Name: "interface-member", Quote: q.library, Lib: "export interface Reader { read(): string }\nexport declare const reader: Reader\n", Body: "⟦reader.read()⟧"})
	add(&failCase{Name: "interface-member-opts-in", Quote: q.fnType, Lib: "export interface Reader {\n  /** @throws {RangeError} */\n  read(): string\n}\nexport declare const reader: Reader\n", Body: "⟦reader.read()⟧"})
	add(&failCase{Name: "function-type-opts-in", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Lib: "export type Reader = {\n  /** @throws {RangeError} */\n  (): string\n}\n", Decls: "function run(f: Reader) { return ⟦f()⟧ }", Body: "run(() => \"x\")", Code: 401})

	// Swift's assignability rule. The rule is about types, so the cases
	// stand in a plain function and need no effect function.
	add(&failCase{Name: "assign-throwing", Quote: q.assignable, Host: "plain", Decls: failParse, Body: "⟦const r: (s: string) => string = parse⟧"})
	add(&failCase{Name: "assign-throwing-argument", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Decls: failParse + "\nfunction run(f: () => string) { return f() }", Body: "run(() => ⟦parse(s)⟧)", Code: 401})
	add(&failCase{Name: "assign-annotated-type", Quote: q.assignable, Host: "plain", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n" + "export type Reader = {\n  /** @throws {Error} */\n  (s: string): string\n}\n", Body: "const r: Reader = parse"})
	add(&failCase{Name: "assign-wrapped", Quote: q.assignable, Host: "plain", Decls: failParse, Body: "const r: () => string = () => {\n  try { return parse(s) } catch { return \"\" }\n}"})

	// Constructors and accessors (decided detail 5).
	add(&failCase{Name: "new-tracked", Quote: q.newTracked, Decls: failInput, Body: "const i = ⟦new Input(s)⟧"})
	add(&failCase{Name: "new-wrapped", Quote: q.newTracked, Decls: failInput, Body: "const i = try Effect.try(() => new Input(s))"})
	add(&failCase{Name: "getter-untracked", Quote: q.accessor, Decls: failInput + "\ndeclare const input: Input", Body: "const v = input.value"})
	add(&failCase{Name: "setter-untracked", Quote: q.accessor, Lib: "export declare class Box {\n  n: number\n  set value(v: number)\n}\nexport declare const box: Box\n", Body: "box.value = xs.length"})

	// @rethrows (decided detail 4).
	add(&failCase{Name: "rethrows-throwing", Quote: q.rethrows, Decls: failParse + "\n" + failInvoke, Body: "⟦invoke(() => parse(s))⟧"})
	add(&failCase{Name: "rethrows-nonthrowing", Quote: q.rethrows, Decls: failInvoke, Body: "invoke(() => s)"})
	add(&failCase{Name: "rethrows-accepts-throwing", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Decls: failParse + "\n" + failInvoke, Body: "⟦invoke(() => parse(s))⟧", Code: 401})
	add(&failCase{Name: "rethrows-library", Quote: q.rethrows, Decls: failParse, Lib: "/** @throws {never} @rethrows f */\nexport declare function each<T>(xs: readonly T[], f: (x: T) => void): void\n", Body: "each(xs, (x) => x)\n⟦each(xs, (x) => { parse(String(x)) })⟧"})
	// Appendix E gives each shipped array method its own row.
	const (
		arrayRow  = "| `Array.prototype.map`, `.forEach`, `.filter`, `.find`, `.some`, `.every`, `.sort` | `@throws {never} @rethrows callbackfn` (`sort`: `@rethrows compareFn`) |"
		reduceRow = "| `Array.prototype.reduce` | without `initialValue`: `@throws {TypeError} @rethrows callbackfn` (`[].reduce(f)` throws); with `initialValue`: `@throws {never} @rethrows callbackfn` |"
		fromRow   = "| `Array.from` | `@throws {never} @rethrows mapfn` |"
	)
	for _, g := range []struct{ name, quote, ok, bad string }{
		{"map", arrayRow, "xs.map((x) => x * 2)", "xs.map((x) => parse(String(x)))"},
		{"forEach", arrayRow, "xs.forEach((x) => add(x, 1))", "xs.forEach((x) => { parse(String(x)) })"},
		{"filter", arrayRow, "xs.filter((x) => x > 0)", "xs.filter((x) => parse(String(x)) !== \"\")"},
		{"reduce", reduceRow, "xs.reduce((a, x) => a + x, 0)", "xs.reduce((a, x) => a + parse(String(x)).length, 0)"},
		{"find", arrayRow, "xs.find((x) => x > 0)", "xs.find((x) => parse(String(x)) === \"1\")"},
		{"some", arrayRow, "xs.some((x) => x > 0)", "xs.some((x) => parse(String(x)) === \"1\")"},
		{"every", arrayRow, "xs.every((x) => x > 0)", "xs.every((x) => parse(String(x)) === \"1\")"},
		{"sort", arrayRow, "[...xs].sort((a, b) => a - b)", "[...xs].sort((a, b) => parse(String(a)).length - b)"},
		{"array-from", fromRow, "Array.from(xs, (x) => x * 2)", "Array.from(xs, (x) => parse(String(x)))"},
	} {
		add(&failCase{Name: "rethrows-" + strings.ToLower(g.name) + "-ok", Chapter: "900-appendices.md", Quote: g.quote, Decls: failParse + "\n" + failAdd, Body: "const r = " + g.ok})
		add(&failCase{Name: "rethrows-" + strings.ToLower(g.name) + "-throwing", Chapter: "900-appendices.md", Quote: g.quote, Decls: failParse + "\n" + failAdd, Body: "const r = ⟦" + g.bad + "⟧"})
	}
	// Decided detail 64 corrects detail 4: executor throws reject the Promise.
	add(&failCase{Name: "rethrows-promise-executor", Chapter: "900-appendices.md", Quote: "| `new Promise(executor)` | `@throws {never}`, no `@rethrows`: a throw in the executor rejects the Promise, as in JavaScript; it never throws at the construction site |", Decls: failParse + "\nfunction start(s: string) { new Promise((resolve) => { resolve(parse(s)) }); return 1 }", Body: "start(s)"})

	// An Effect, Stream or Layer returner can't throw, so its body may not.
	add(&failCase{Name: "effectful-body-throw", Quote: q.effectfulBody, Host: "none", Decls: "⟦export function bad(id: string) { if (!id) throw new Error(\"empty\"); return Effect.succeed(id) }⟧"})
	add(&failCase{Name: "effectful-body-call", Quote: q.effectfulBody, Host: "none", Decls: failParse + "\n⟦export function lines(s: string) { parse(s); return Stream.succeed(s) }⟧"})
	add(&failCase{Name: "effectful-body-fail", Quote: q.effectfulBody, Host: "none", Decls: "error BadInput\nexport function load(id: string): Effect.Effect<string, BadInput> { return id ? Effect.succeed(id) : fail(new BadInput()) }"})
	add(&failCase{Name: "effectful-body-wrapped", Quote: q.effectfulBody, Host: "none", Decls: failParse + "\nexport function load(s: string) { return Effect.try(() => parse(s)) }"})

	// A default initializer is a call in effect code.
	add(&failCase{Name: "default-throwing", Quote: q.defaultInit, Host: "none", Decls: failParse + "\nexport effect function probe(s: string = ⟦parse(\"\")⟧) { return s }"})
	add(&failCase{Name: "default-nonthrowing", Quote: q.defaultInit, Host: "none", Decls: failAdd + "\nexport effect function probe(n: number = add(1, 2)) { return n }"})

	// Implicit throws are not tracked.
	add(&failCase{Name: "implicit-undefined-property", Quote: q.implicit, Decls: "function deep(o: { a?: { b: number } }) { return o.a!.b }", Body: "const b = deep({})"})
	add(&failCase{Name: "implicit-recursion", Quote: q.implicit, Decls: "function down(n: number): number { return n <= 0 ? 0 : down(n - 1) + 1 }", Body: "const d = down(xs.length)"})

	// Static rule 2: Promises.
	add(&failCase{Name: "promise-async-local", Quote: q.promiseCall, Decls: failLater, Body: "⟦later(s)⟧"})
	add(&failCase{Name: "promise-held", Quote: q.promiseCall, Decls: failLater, Body: "const p = ⟦later(s)⟧"})
	add(&failCase{Name: "promise-library", Quote: q.promiseCall, Lib: "/** @throws {never} */\nexport declare function query(q: string): Promise<number>\n", Body: "const p = ⟦query(s)⟧"})
	add(&failCase{Name: "promise-thenable", Quote: q.promiseCall, Lib: "/** @throws {never} */\nexport declare function soon(): PromiseLike<number>\n", Body: "const p = ⟦soon()⟧"})
	add(&failCase{Name: "promise-library-wrapped", Quote: q.promiseCall, Lib: "/** @throws {never} */\nexport declare function query(q: string): Promise<number>\n", Body: "const n = try tryPromise(() => query(s))"})
	add(&failCase{Name: "promise-reject", Quote: q.promiseReject, Body: "const p = ⟦Promise.reject(new Error(s))⟧"})
	add(&failCase{Name: "promise-reject-wrapped", Quote: q.promiseReject, Body: "const n = try tryPromise(() => Promise.reject(new Error(s)))"})
	add(&failCase{Name: "promise-in-plain", Quote: q.wrappersStill, Host: "plain", Decls: failLater, Body: "const p = later(s)"})

	// Declaration output (001-functions.md), from its own example.
	add(&failCase{Name: "declaration-throws", Chapter: "001-functions.md", VIP: 27, Owner: "nothrow-impl", Quote: nothrowQ.declThrows, Host: "none", Decls: "export error BadInput\nexport function parse(s: string) { return s.trim() }\nexport const add = (a: number, b: number) => a + b\nexport class Id {\n  constructor(readonly s: string) {}\n  get size() { return this.s.length }\n}", Throws: map[string]string{"parse": "{never}", "add": "{never}", "constructor": "{never}", "size": ""}})
	add(&failCase{Name: "declaration-effectful", Chapter: "001-functions.md", VIP: 27, Quote: "- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one",
		Host:   "none",
		Decls:  "export effect function load(id: string) { if (!id) throw new Error(\"empty\"); return id }\nexport function users(ids: string[]) { return Stream.fromIterable(ids) }",
		Throws: map[string]string{"load": "", "users": ""}})
	add(&failCase{Name: "declaration-async", Chapter: "001-functions.md", VIP: 27, Quote: "- **Thrown types.** A `.vibe` callable throws `never` ([Thrown types](003-failures.md#thrown-types)), so the output states the same on every call signature it emits other than an effectful one",
		Host:   "none",
		Decls:  "export async function get(q: string) { if (!q) throw new Error(\"empty\"); return q }",
		Throws: map[string]string{"get": "{never}"}})

	// error declarations (VIP-13; decided details 8, 9, 24).
	for _, form := range []struct{ prefix, owner string }{{"error", "fix-vip-decls"}, {"schema error", "fix-vip-decls"}} {
		name := strings.ReplaceAll(form.prefix, " ", "-")
		vip := 13
		if form.prefix != "error" {
			vip = 29
		}
		decl := func(n, quote, text string) {
			add(&failCase{Name: name + "-" + n, Quote: quote, Owner: form.owner, VIP: vip, Host: "none", Decls: text})
		}
		// The chapter does not say where the error stands; any error in the
		// declaration meets it.
		decl("constructor", "| a constructor in an `error` or `schema error` body | `EK1301` |", "⟦export "+form.prefix+" Bad { id: string; constructor() { super({ id: \"x\" }) } }⟧")
		decl("tag", "| a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `\"_tag\"`; use a literal key or a symbol | `EK2117` |", "⟦export "+form.prefix+" Bad { _tag: string }⟧")
		decl("extends", "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |", "export "+form.prefix+" NotFound { id: string }\n⟦export "+form.prefix+" UserNotFound extends NotFound { name: string }⟧")
		decl("static", "| a user-written `static` member or setter, in either error form | `EK1302` |", "⟦export "+form.prefix+" Bad { id: string; static make() { return 1 } }⟧")
		decl("setter", "| a user-written `static` member or setter, in either error form | `EK1302` |", "⟦export "+form.prefix+" Bad { id: string; set name(v: string) {} }⟧")
		decl("type-parameters", "| type parameters, such as `error Invalid<T> { value: T }`, in either error form | `EK1303` |", "⟦export "+form.prefix+" Invalid<T> { value: T }⟧")
		decl("readonly", "`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly. Optional `id?: T` maps to `readonly id?: T`, as in a TypeScript type literal. Fields, methods and getters may be interleaved, as in a TypeScript class.", "export "+form.prefix+" Bad { id: string }\nexport function rename(e: Bad) { ⟦e.id⟧ = \"y\" }")
		decl("bodyless", "[SchemaErrorDeclaration](900-appendices.md#schemaerrordeclaration). Its [ErrorBody](900-appendices.md#errorbody) is shared with `error`. Each field's type is mapped as in a `schema` declaration, optional properties included. Every field is readonly, as in `error`, so no field gets `Schema.mutableKey`. Omitting the body means no fields, as for `error Timeout`, and the body boundary is the same as for `error`.", "export "+form.prefix+" Timeout\nexport const t = new Timeout()")
		decl("optional-field", "[SchemaErrorDeclaration](900-appendices.md#schemaerrordeclaration). Its [ErrorBody](900-appendices.md#errorbody) is shared with `error`. Each field's type is mapped as in a `schema` declaration, optional properties included. Every field is readonly, as in `error`, so no field gets `Schema.mutableKey`. Omitting the body means no fields, as for `error Timeout`, and the body boundary is the same as for `error`.", "export "+form.prefix+" Bad { id?: string }\nexport const b = new Bad({})")
		decl("fields-object", "An error is constructed with its fields as one object, `new NotFound({ id })`.", "export "+form.prefix+" NotFound { id: string }\nexport const e = new NotFound({ id: \"x\" })\nexport const id: string = e.id\nexport const tag: \"NotFound\" = e._tag")
	}
	add(&failCase{Name: "error-interleaved", VIP: 13, Owner: "fix-vip-decls", Host: "none", Quote: "`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly. Optional `id?: T` maps to `readonly id?: T`, as in a TypeScript type literal. Fields, methods and getters may be interleaved, as in a TypeScript class.",
		Decls: "export error NotFound {\n  id: string\n  get message() { return `no user ${this.id}` }\n  code: number\n  describe() { return this.id + this.code }\n}\nexport const m: string = new NotFound({ id: \"x\", code: 1 }).describe()"})
	add(&failCase{Name: "error-contextual", VIP: 13, Owner: "fix-vip-decls", Host: "none", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).",
		Decls: "export const error = 1\nexport function f() {\n  try { return JSON.parse(\"1\") } catch (error) { return error }\n}"})
	// Appendix A Separator (decided detail 241): body members on one line need
	// a separator, whatever the members and the gap between them are.
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for i, next := range []string{" ⟦b⟧: string", " /* gap */ ⟦b⟧?: string", "\t⟦readonly⟧ b: string", " ⟦get⟧ b() { return 1 }", " ⟦describe⟧() { return 1 }"} {
			add(&failCase{Name: fmt.Sprintf("%s-missing-separator-%d", strings.ReplaceAll(form.prefix, " ", "-"), i), Chapter: failuresChapter, VIP: form.vip, Owner: "impl-hunt-fail", Host: "none", Code: 1306, OneDiagnostic: true,
				Quote: "| two members on one line with no separator, in either error form; write `;` or a line break between them (quick fix: insert `;`) | `EK1306` |",
				Decls: "export " + form.prefix + " E { a: number" + next + " }"})
		}
	}
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for _, member := range []struct{ key, source string }{
			{"signature", "a(): number ⟦a⟧(): number { return 1 }"},
			{"decorator", "a: number ⟦@⟧dec b() { return 1 }"},
		} {
			add(&failCase{Name: strings.ReplaceAll(form.prefix, " ", "-") + "-" + member.key + "-missing-separator",
				Chapter: failuresChapter, VIP: form.vip, Owner: "impl-hunt-fail", Host: "none", Code: 1306, OneDiagnostic: true,
				Quote: "| two members on one line with no separator, in either error form; write `;` or a line break between them (quick fix: insert `;`) | `EK1306` |",
				Decls: "declare const dec: any; export " + form.prefix + " E { " + member.source + " }"})
		}
	}
	// A field naming a rejected type parameter gets no second diagnostic,
	// such as EK2109 for a schema error's field schema.
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for _, shape := range []struct{ key, params, fields string }{
			{"value", "T", "value: T"},
			{"array", "T", "items: T[]"},
			{"optional", "T", "value?: T"},
			{"union", "T", "value: T | string"},
			{"tuple", "T, U", "pair: [T, U]"},
			{"record", "K extends string", "map: Record<K, number>"},
			{"mixed", "T", "id: string; value: T; count: number"},
		} {
			add(&failCase{Name: strings.ReplaceAll(form.prefix, " ", "-") + "-type-parameter-field-" + shape.key,
				Chapter: failuresChapter, VIP: form.vip, Owner: "impl-hunt-fail", Host: "none", Code: 1303, OneDiagnostic: true,
				Quote: "| type parameters, such as `error Invalid<T> { value: T }`, in either error form | `EK1303` |",
				Decls: "⟦export " + form.prefix + " Invalid<" + shape.params + "> { " + shape.fields + " }⟧"})
		}
	}
	add(&failCase{Name: "schema-error-named-error", VIP: 29, Owner: "fix-vip-decls", Host: "none", Quote: "`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token. `schema error { id: string }` is a schema named `error`: `{` is not the name required after `schema error`.",
		Decls: "schema error = \"a\" | \"b\"\nexport schema error NotFound { id: string }\nexport const n = new NotFound({ id: \"x\" })\nexport const e = Schema.decodeUnknownSync(error)(\"a\")"})
	add(&failCase{Name: "assign-object-member", Quote: "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`", Host: "plain", Body: "⟦const r: { read: (s: string) => string } = { read: parse }⟧", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }"})
	add(&failCase{Name: "wrapper-catch-throw", Owner: "nothrow-impl", Quote: nothrowQ.literal, Host: "plain", Body: "Effect.try({ try: () => s, catch: () => { ⟦throw new Error(\"bad\")⟧ } })", Code: 401})
	add(&failCase{Name: "wrapper-sync-throw", Owner: "nothrow-impl", Quote: nothrowQ.knownCall, Host: "plain", Body: "sync(() => ⟦parse(s)⟧)", Decls: failParse, Code: 401})
	add(&failCase{Name: "wrapper-promise-throw", Owner: "nothrow-impl", Quote: nothrowQ.throwStmt, Host: "plain", Body: "promise(() => { ⟦throw new Error(\"bad\")⟧ })", Code: 401})
	add(&failCase{Name: "wrapper-trypromise-options", Owner: "nothrow-impl", Quote: nothrowQ.thunks, Host: "effect", Body: "const p = try tryPromise({ try: () => { if (!s) ⟦throw new Error(\"bad\")⟧; return Promise.resolve(s) }, catch: (e) => e })", Code: 401})
	add(&failCase{Name: "catch-tracked-call", Owner: "nothrow-impl", Quote: nothrowQ.handler, Host: "effect", Body: "Effect.fail(new Error(\"input\")) catch (e) => ⟦parse(s)⟧", Decls: failParse, Code: 401})
	add(&failCase{Name: "catch-explicit-throw", Owner: "nothrow-impl", Quote: nothrowQ.handler, Host: "effect", Body: "return Effect.fail(new Error(\"input\")) catch (e) => { ⟦throw e⟧ }", Code: 401})
	add(&failCase{Name: "catch-caught-explicit-throw", Owner: "compiler", Quote: nothrowQ.literal, Host: "effect", Body: "return Effect.fail(new Error(\"input\")) catch (e) => { try { ⟦throw e⟧ } catch { return 0 } }", Code: 401})
	add(&failCase{Name: "catch-nested-effect-control", Owner: "compiler", Quote: nothrowQ.literal, Host: "effect", Body: "return Effect.fail(new Error(\"input\")) catch (e) => { const nested = effect () => { throw e }; return 0 }"})
	add(&failCase{Name: "catch-effect-throw-control", Owner: "compiler", Quote: nothrowQ.literal, Host: "effect", Body: "return Effect.fail(new Error(\"input\")) catch effect (e) => { throw e }"})
	add(&failCase{Name: "foreign-const", Quote: "| no tag | `unknown` |", Host: "effect", Body: "⟦foreign(s)⟧", Lib: "export declare const foreign: (s: string) => string"})
	add(&failCase{Name: "foreign-method", Quote: "| no tag | `unknown` |", Host: "effect", Body: "⟦foreign.read(s)⟧", Lib: "export declare class Reader { read(s: string): string }\nexport declare const foreign: Reader"})
	// A tag on a function-type alias does not attach: the call is untagged,
	// so it throws unknown; a tag on the call signature or the const does attach.
	for _, alias := range []struct {
		key, lib string
		code     int
	}{
		{"error", "/** @throws {Error} */\nexport type Reader = () => string\nexport declare const read: Reader", 403},
		{"unknown", "/** @throws {unknown} */\nexport type Reader = () => string\nexport declare const read: Reader", 403},
		{"generic", "/** @throws {never} */\nexport type Make<T> = () => T\nexport declare const read: Make<string>", 403},
		{"nested", "/** @throws {never} */\nexport type Base = () => string\nexport type Reader = Base\nexport declare const read: Reader", 403},
		{"parenthesized", "/** @throws {never} */\nexport type Reader = (() => string)\nexport declare const read: Reader", 403},
		{"signature-control", "export type Reader = {\n  /** @throws {never} */\n  (): string\n}\nexport declare const read: Reader", 0},
		{"const-control", "export type Reader = () => string\n/** @throws {never} */\nexport declare const read: Reader", 0},
	} {
		body := "const v = read()"
		if alias.code != 0 {
			body = "const v = ⟦read()⟧"
		}
		add(&failCase{Name: "foreign-alias-tag-" + alias.key, VIP: 4, Owner: "impl-hunt-fail", Quote: "a tag on an alias of a function type does not attach", Lib: alias.lib, Body: body, Code: alias.code, OneDiagnostic: alias.code != 0})
	}
	// A literal passed to a @rethrows parameter: its own calls known to throw
	// belong to the enclosing call, whose own never does not erase them.
	for _, r := range []struct {
		key, host, body string
		code            int
	}{
		{"own-never", "effect", "const v = ⟦invoke(() => parse(s))⟧", 403},
		{"nested-call", "effect", "const v = ⟦invoke(() => invoke(() => parse(s)))⟧", 403},
		{"map", "effect", "const v = ⟦xs.map((x) => parse(s))⟧", 403},
		{"caught", "effect", "const v = invoke(() => { try { return parse(s) } catch { return s } })", 0},
		{"safe", "effect", "const v = invoke(() => s)", 0},
		{"wrapped", "effect", "const v = try Effect.try(() => invoke(() => parse(s)))", 0},
		{"nested-function", "effect", "const v = invoke(() => { const f = () => ⟦parse(s)⟧; return s })", 401},
		{"plain-host", "plain", "const v = ⟦invoke(() => parse(s))⟧", 401},
		{"plain-caught", "plain", "try { invoke(() => parse(s)) } catch { }", 0},
		{"constructor", "effect", "const v = ⟦new Invoke(() => parse(s))⟧", 403},
		{"constructor-plain", "plain", "const v = ⟦new Invoke(() => parse(s))⟧", 401},
		{"constructor-safe", "effect", "const v = new Invoke(() => s)", 0},
		{"constructor-caught", "plain", "try { new Invoke(() => parse(s)) } catch { }", 0},
		{"constructor-wrapped", "effect", "const v = try Effect.try(() => new Invoke(() => parse(s)))", 0},
		{"class-base", "effect", "const v = ⟦invoke⟧(() => { class C extends makeBase() {}; return s })", 403},
		{"enum-initializer", "effect", "const v = ⟦invoke⟧(() => { enum E { Value = parse(s).length }; return s })", 403},
		{"do-expression", "effect", "const v = ⟦invoke⟧(() => do { parse(s) })", 403},
		{"class-static-block", "effect", "const v = invoke(() => { class C { static { ⟦parse(s)⟧ } }; return s })", 401},
		{"class-base-caught", "effect", "const v = invoke(() => { try { class C extends makeBase() {}; return s } catch { return s } })", 0},
		{"enum-caught", "effect", "const v = invoke(() => { try { enum E { Value = parse(s).length }; return s } catch { return s } })", 0},
		{"do-caught", "effect", "const v = invoke(() => { try { return do { parse(s) } } catch { return s } })", 0},
	} {
		add(&failCase{Name: "rethrows-literal-" + r.key, VIP: 4, Quote: "may contain calls known to throw: they belong to the enclosing call", Host: r.host, Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n/**\n * @throws {never}\n * @rethrows f\n */\nexport declare function invoke(f: () => string): string\n/** @throws {Error} */\nexport declare function makeBase(): new () => object\nexport declare class Invoke {\n/**\n * @throws {never}\n * @rethrows f\n */\nconstructor(f: () => string)\n}", Body: r.body, Code: r.code, OneDiagnostic: r.code != 0})
	}

	for _, r := range []struct {
		key, body string
		code      int
	}{
		{"async", "const v = invoke(async () => parse(s))", 0},
		{"async-generator", "const v = invoke(async function* () { return parse(s) })", 0},
		{"generator-body", "const v = invoke(function* () { return ⟦parse(s)⟧ })", 401},
		{"class-field", "const v = invoke(() => { class C { value = ⟦parse(s)⟧ }; return 0 })", 401},
		{"effect-body", "const v = consume(effect () => { return ⟦parse(s)⟧ })", 403},
	} {
		add(&failCase{Name: "rethrows-literal-boundary-" + r.key, Quote: "nested source callables keep their own contexts", Host: "plain", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n/**\n * @throws {never}\n * @rethrows f\n */\nexport declare function invoke<T>(f: () => T): T\n/**\n * @throws {never}\n * @rethrows f\n */\nexport declare function consume<T>(f: () => T): void", Body: r.body, Code: r.code, OneDiagnostic: r.code != 0})
	}

	for _, r := range []struct{ key, body string }{
		{"effect-parameter", "const v = consume(effect (x = ⟦parse(s)⟧) => x)"},
		{"effectful-factory-body", "const v = consume(() => { const x = ⟦parse(s)⟧; return Effect.succeed(x) })"},
		{"effectful-factory-parameter", "const v = consume((x = ⟦parse(s)⟧) => Effect.succeed(x))"},
	} {
		add(&failCase{Name: "rethrows-literal-" + r.key, Quote: "A plain function whose return type is wholly effectful, and an effectful function's parameter list, are stricter: any thrown type other than `never` is `EK0401`", Host: "plain", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n/**\n * @throws {never}\n * @rethrows f\n */\nexport declare function consume<T>(f: () => T): void", Body: r.body, Code: 401, OneDiagnostic: true})
	}

	for _, r := range []struct {
		key, host, body string
		code            int
	}{
		{"effect", "effect", "const v = ⟦tag⟧`value: ${() => parse(s)}`", 403},
		{"plain", "plain", "const v = ⟦tag⟧`value: ${() => parse(s)}`", 401},
		{"method", "effect", "const v = ⟦holder.tag⟧`value: ${() => parse(s)}`", 403},
		{"alias", "effect", "const t = tag; const v = ⟦t⟧`value: ${() => parse(s)}`", 403},
		{"later", "effect", "const v = ⟦later⟧`prefix: ${s} value: ${() => parse(s)}`", 403},
		{"rest", "effect", "⟦rest⟧`safe: ${() => s} bad: ${() => parse(s)}`", 403},
		{"nested", "effect", "const v = ⟦tag⟧`outer: ${() => tag`inner: ${() => parse(s)}`}`", 403},
		{"safe", "effect", "const v = tag`value: ${() => s}`", 0},
		{"caught", "plain", "try { tag`value: ${() => parse(s)}` } catch { }", 0},
		{"wrapped", "effect", "const v = try Effect.try(() => tag`value: ${() => parse(s)}`)", 0},
		{"nested-function", "effect", "const v = tag`value: ${() => { const f = () => ⟦parse(s)⟧; return s }}`", 401},
		{"async", "plain", "const v = tag`value: ${async () => parse(s)}`", 0},
		{"effect-parameter", "plain", "const v = tag`value: ${effect (x = ⟦parse(s)⟧) => x}`", 401},
	} {
		add(&failCase{Name: "rethrows-tagged-literal-" + r.key, Quote: "may contain calls known to throw: they belong to the enclosing call", Host: r.host, Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n/**\n * @throws {never}\n * @rethrows f\n */\nexport declare function tag<T>(parts: TemplateStringsArray, f: () => T): T\n/**\n * @throws {never}\n * @rethrows f\n */\nexport declare function later<T>(parts: TemplateStringsArray, prefix: string, f: () => T): T\n/**\n * @throws {never}\n * @rethrows callbacks\n */\nexport declare function rest(parts: TemplateStringsArray, ...callbacks: (() => string)[]): void\nexport declare const holder: {\n/**\n * @throws {never}\n * @rethrows f\n */\ntag<T>(parts: TemplateStringsArray, f: () => T): T\n}", Body: r.body, Code: r.code, OneDiagnostic: r.code != 0})
	}
	add(&failCase{Name: "foreign-overload", Quote: "| no tag | `unknown` |", Host: "effect", Body: "⟦foreign(s)⟧", Lib: "export declare function foreign(s: string): string\nexport declare function foreign(s: number): number"})
	add(&failCase{Name: "dynamic-any", Quote: "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives.", Host: "effect", Body: "⟦f(s)⟧", Decls: "declare const f: any"})
	add(&failCase{Name: "dynamic-function", Quote: "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives.", Host: "effect", Body: "⟦f(s)⟧", Decls: "declare const f: Function"})
	add(&failCase{Name: "effectful-mixed-return", Quote: "`never`, `any`, `unknown` and unions with a non-effectful member, such as `Effect.Effect<number> | undefined`, are not effectful, so they keep the rules above.", Host: "effect", Body: "⟦uncertain(s)⟧", Decls: "function uncertain(s: string): Effect.Effect<number> | undefined { if (!s) throw new Error(\"empty\"); return undefined }"})
	add(&failCase{Name: "effectful-any-return", Quote: "`never`, `any`, `unknown` and unions with a non-effectful member, such as `Effect.Effect<number> | undefined`, are not effectful, so they keep the rules above.", Host: "effect", Body: "⟦uncertain(s)⟧", Decls: "function uncertain(s: string): any { if (!s) throw new Error(\"empty\"); return 1 }"})
	add(&failCase{Name: "effectful-error-value", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`", Host: "effect", Body: "missing()", Decls: "error Missing\nfunction missing() { return new Missing() }"})
	add(&failCase{Name: "error-new-never", Quote: "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators.", Host: "effect", Body: "const m = new Missing()", Decls: "error Missing"})
	add(&failCase{Name: "schema-error-new-never", Quote: "A generated `schema error` constructor has thrown type `never`, a static contract.", Host: "effect", Body: "const m = new Missing({ id: s })", Decls: "schema error Missing { id: string }"})
	add(&failCase{Name: "recursive-never", Quote: "Nothing is inferred from a body.", Host: "effect", Body: "const n = fib(xs.length)", Decls: "function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }"})
	add(&failCase{Name: "default-promise", Quote: "A default that returns a Promise is a plain value.", Host: "none", Decls: "async function resolved() { return 1 }\nexport effect function probe(p = resolved()) { return p }"})
	add(&failCase{Name: "error-rejected-initializer", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export error Bad { id = 1 }⟧"})
	add(&failCase{Name: "error-rejected-private-field", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export error Bad { private id: string }⟧"})
	add(&failCase{Name: "error-rejected-index-signature", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export error Bad { [key: string]: number }⟧"})
	add(&failCase{Name: "schema-error-rejected-initializer", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export schema error Bad { id = 1 }⟧"})
	add(&failCase{Name: "schema-error-rejected-private-field", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export schema error Bad { private id: string }⟧"})
	add(&failCase{Name: "schema-error-rejected-index-signature", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export schema error Bad { [key: string]: number }⟧"})
	add(&failCase{Name: "tagged-template-throw", Quote: "- A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function.", Host: "effect", Body: "const value = ⟦tag`literal`⟧", Decls: "function tag(parts: TemplateStringsArray) { throw new Error(\"bad\") }"})
	add(&failCase{Name: "tagged-template-never", Quote: "- A call, `new` expression, tagged template or class evaluation *known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function.", Host: "effect", Body: "const value = tag`literal`", Decls: "function tag(parts: TemplateStringsArray) { return parts[0] }"})
	add(&failCase{Name: "callable-union-throw", Quote: "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives.", Host: "effect", Body: "⟦f(s)⟧", Decls: "function bad(s: string) { throw new Error(s) }\nfunction safe(s: string) { return s }\ndeclare const cond: boolean\nconst f = cond ? bad : safe"})
	add(&failCase{Name: "effectful-unknown-return", Quote: "`never`, `any`, `unknown` and unions with a non-effectful member, such as `Effect.Effect<number> | undefined`, are not effectful, so they keep the rules above.", Host: "effect", Body: "⟦uncertain(s)⟧", Decls: "function uncertain(s: string): unknown { if (!s) throw new Error(\"bad\"); return 1 }"})
	add(&failCase{Name: "effectful-whole-union", Quote: "`never`, `any`, `unknown` and unions with a non-effectful member, such as `Effect.Effect<number> | undefined`, are not effectful, so they keep the rules above.", Host: "effect", Body: "const value = uncertain(s)", Lib: "import { Effect, Stream } from \"effect\"\nexport declare function uncertain(s: string): Effect.Effect<number> | Stream.Stream<number>"})
	add(&failCase{Name: "error-empty-elements", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export error Missing { id: string; ; get message() { return this.id }; }"})
	add(&failCase{Name: "schema-error-empty-elements", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export schema error Missing { id: string; ; get message() { return this.id }; }"})
	add(&failCase{Name: "error-explicit-readonly", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export error Missing { readonly id: string }\nexport const m = new Missing({ id: \"x\" })"})
	add(&failCase{Name: "schema-error-explicit-readonly", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export schema error Missing { readonly id: string }\nexport const m = new Missing({ id: \"x\" })"})
	add(&failCase{Name: "never-return-throw", Quote: q.effectful, Decls: "function boom(): never { throw new Error(\"bad\") }", Body: "⟦boom()⟧"})

	add(&failCase{Name: "declaration-global-throws", Chapter: "001-functions.md", VIP: 27, Owner: "nothrow-impl", Quote: nothrowQ.declThrows, Host: "none", Decls: "export function decode(s: string) { try { return JSON.parse(s) } catch { return undefined } }\nexport function largest(xs: number[]) { return Math.max(...xs) }", Throws: map[string]string{"decode": "{never}", "largest": "{never}"}})
	add(&failCase{Name: "foreign-declared-type-never", Quote: "| no tag | `unknown` |", Host: "effect", Body: "read(s)", Lib: "type Reader = {\n /** @throws {never} */\n (s: string): string\n}\nexport declare const read: Reader"})
	add(&failCase{Name: "foreign-own-tag-over-type", Quote: "| no tag | `unknown` |", Host: "effect", Body: "read(s)", Lib: "type Reader = {\n /** @throws {Error} */\n (s: string): string\n}\n/** @throws {never} */\nexport declare const read: Reader"})

	for _, builtin := range []struct{ key, signature, call string }{
		{"parse", "JSON.parse", "foreign(s)"},
		{"max", "Math.max", "foreign(1, 2)"},
	} {
		for _, tag := range []struct{ key, bound string }{{"range", "RangeError"}, {"unknown", "unknown"}, {"never", "never"}} {
			for _, wrapped := range []bool{false, true} {
				name := "binding-intrinsic-" + builtin.key + "-" + tag.key
				body := builtin.call
				code := 0
				if wrapped {
					name += "-wrapped"
					body = "try Effect.try(() => " + body + ")"
				} else if tag.bound != "never" {
					body = "⟦" + body + "⟧"
					code = 403
				}
				add(&failCase{Name: name, Quote: q.library, Lib: "/** @throws {" + tag.bound + "} */\nexport declare const foreign: typeof " + builtin.signature, Body: "const value = " + body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	for _, wrapped := range []bool{false, true} {
		name, body, code := "binding-intrinsic-property", "⟦holder.parse(s)⟧", 403
		if wrapped {
			name, body, code = name+"-wrapped", "try Effect.try(() => holder.parse(s))", 0
		}
		add(&failCase{Name: name, Quote: q.library, Lib: "export declare const holder: {\n/** @throws {RangeError} */\nparse: typeof JSON.parse\n}", Body: "const value = " + body, Code: code, OneDiagnostic: code != 0})
	}
	// A written thrown type uses TypeScript's never after type reduction.
	for _, bound := range []struct {
		key, declarations, text string
		throwing                bool
	}{
		{"alias", "type Quiet = never;", "Quiet", false},
		{"parenthesized", "type Quiet = never;", "(Quiet)", false},
		{"union", "type Quiet = never;", "Quiet | never", false},
		{"extract", "", "Extract<string, number>", false},
		{"exclude", "", "Exclude<'value', 'value'>", false},
		{"intersection", "", "string & number", false},
		{"generic", "type Empty<T> = Exclude<T, T>;", "Empty<string>", false},
		{"array-control", "", "never[]", true},
	} {
		for _, style := range []string{"binding", "function"} {
			lib := bound.declarations + "\n/** @throws {" + bound.text + "} */\n"
			if style == "binding" {
				lib += "export declare const read:typeof JSON.parse"
			} else {
				lib += "export declare function read(s:string):unknown"
			}
			for _, context := range []string{"effect", "plain", "wrapped"} {
				name := "throws-never-type-" + bound.key + "-" + style + "-" + context
				host, body, code := "effect", "read(s)", 0
				if context == "plain" {
					host = "plain"
				}
				if context == "wrapped" {
					body = "try Effect.try(()=>" + body + ")"
				} else if bound.throwing {
					body = "⟦" + body + "⟧"
					code = 403
					if host == "plain" {
						code = 401
					}
				}
				add(&failCase{Name: name, Quote: q.inferred, Host: host, Lib: lib, Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}

	for _, builtin := range []struct{ key, signature, call string }{
		{"parse", "JSON.parse", "again(s)"},
		{"max", "Math.max", "again(1, 2)"},
	} {
		for _, tag := range []struct{ key, bound string }{{"range", "RangeError"}, {"unknown", "unknown"}, {"never", "never"}} {
			for _, chain := range []bool{false, true} {
				for _, wrapped := range []bool{false, true} {
					name := "binding-alias-" + builtin.key + "-" + tag.key
					binding := "const again = foreign;\n"
					if chain {
						name += "-chain"
						binding = "const first = foreign; const again = (first);\n"
					}
					body, code := builtin.call, 0
					if wrapped {
						name += "-wrapped"
						body = "try Effect.try(() => " + body + ")"
					} else if tag.bound != "never" {
						body = "⟦" + body + "⟧"
						code = 403
					}
					add(&failCase{Name: name,
						Quote: "`const g = f` preserves `f`'s contract;",
						Lib:   "/** @throws {" + tag.bound + "} */\nexport declare const foreign: typeof " + builtin.signature,
						Body:  binding + "const value = " + body, Code: code, OneDiagnostic: code != 0})
				}
			}
		}
	}

	for _, row := range []struct{ key, binding string }{
		{"reassign", "let again = foreign; again = JSON.parse;"},
		{"const-reassign", "let first = foreign; first = JSON.parse; const again = first;"},
	} {
		for _, wrapped := range []bool{false, true} {
			name, body, code := "binding-alias-mutable-"+row.key, "⟦again(s)⟧", 403
			if wrapped {
				name, body, code = name+"-wrapped", "try Effect.try(() => again(s))", 0
			}
			add(&failCase{Name: name, Quote: q.directCall,
				Lib:  "/** @throws {never} */\nexport declare const foreign: typeof JSON.parse",
				Body: row.binding + "\nconst value = " + body, Code: code, OneDiagnostic: code != 0})
		}
	}

	for _, signature := range []struct{ key, prefix, name string }{
		{"alias", "type Reader=(s:string)=>string\n", "Reader"},
		{"interface", "interface Reader{(s:string):string}\n", "Reader"},
		{"signature", "/** @throws {Error} */\nexport declare function base(s:string):string\n", "typeof base"},
	} {
		for _, tag := range []struct{ key, bound string }{{"never", "never"}, {"range", "RangeError"}} {
			for _, wrapped := range []bool{false, true} {
				name, body, code := "binding-alias-"+signature.key+"-"+tag.key, "again(s)", 0
				if wrapped {
					name, body = name+"-wrapped", "try Effect.try(() => "+body+")"
				} else if tag.bound != "never" {
					body, code = "⟦"+body+"⟧", 403
				}
				add(&failCase{Name: name, Quote: "`const g = f` preserves `f`'s contract;",
					Lib:  signature.prefix + "/** @throws {" + tag.bound + "} */\nexport declare const foreign:" + signature.name,
					Body: "const first=foreign; const again=first;\nconst value=" + body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}

	add(&failCase{Name: "binding-alias-plain-never", Quote: q.library, Host: "plain",
		Lib:  "/** @throws {never} */\nexport declare const foreign:typeof JSON.parse",
		Body: "const again=foreign; return again(s)"})
	add(&failCase{Name: "binding-alias-plain-range", Quote: q.plainPropagates, Host: "plain",
		Lib:  "type Reader=(s:string)=>string\n/** @throws {RangeError} */\nexport declare const foreign:Reader",
		Body: "const again=foreign; ⟦return again(s)⟧", Code: 401, OneDiagnostic: true})

	for _, chain := range []bool{false, true} {
		for _, wrapped := range []bool{false, true} {
			name, binding := "binding-alias-legacy-marker", "const again=foreign;"
			if chain {
				name, binding = name+"-chain", "const first=foreign; const again=first;"
			}
			body, code := "⟦again(s)⟧", 403
			if wrapped {
				name, body, code = name+"-wrapped", "try Effect.try(() => again(s))", 0
			}
			add(&failCase{Name: name, Quote: q.directCall,
				Lib:  "/** @vibelang trusted */\nexport declare const foreign:typeof JSON.parse",
				Body: binding + "\nconst value=" + body, Code: code, OneDiagnostic: code != 0})
		}
	}

	// A const alias retains a foreign type that TypeScript reduces to never.
	for _, bound := range []struct{ key, text string }{
		{"alias", "Quiet"}, {"parenthesized", "(Quiet)"}, {"union", "Quiet | never"}, {"conditional", "Extract<string,number>"},
	} {
		for _, builtin := range []struct{ key, signature, args string }{
			{"parse", "JSON.parse", "s"}, {"max", "Math.max", "1,2"},
		} {
			for _, chain := range []bool{false, true} {
				for _, plain := range []bool{false, true} {
					name := "binding-alias-reduced-never-" + bound.key + "-" + builtin.key
					binding := "const again=read;"
					if chain {
						name += "-chain"
						binding = "const first=read;const again=first;"
					}
					host := "effect"
					if plain {
						name += "-plain"
						host = "plain"
					}
					add(&failCase{Name: name, Quote: q.inferred, Host: host, Lib: "type Quiet=never;\n/** @throws {" + bound.text + "} */\nexport declare const read:typeof " + builtin.signature, Body: binding + "again(" + builtin.args + ")"})
				}
			}
		}
	}

	// Generic throws metadata uses the selected signature and receiver substitutions.
	for _, bound := range []struct {
		key, text string
		throwing  bool
	}{{"never", "never", false}, {"range", "RangeError", true}} {
		for _, shape := range []struct{ key, lib, call string }{
			{"function", "/** @throws {T} */\nexport declare function read<T>():number", "read<%s>()"},
			{"default", "/** @throws {T} */\nexport declare function read<T=never>():number", "read<%s>()"},
			{"conditional", "/** @throws {T extends string ? never : RangeError} */\nexport declare function read<T>():number", "read<%s>()"},
			{"callable", "export interface Reader<T>{\n/** @throws {T} */\n():number}\nexport declare const read:Reader<%s>", "read()"},
			{"method", "export interface Reader<T>{\n/** @throws {T} */\nread():number}\nexport declare const read:Reader<%s>", "read.read()"},
			{"inherited", "export interface Base<T>{\n/** @throws {T} */\nread():number}\nexport interface Reader<U> extends Base<U>{}\nexport declare const read:Reader<%s>", "read.read()"},
			{"constructor", "export declare class read<T>{\n/** @throws {T} */\nconstructor()}", "new read<%s>()"},
			{"tag", "/** @throws {T} */\nexport declare function read<T>(parts:TemplateStringsArray):number", "read<%s>`value`"},
		} {
			for _, context := range []string{"effect", "plain", "wrapped"} {
				name := "throws-generic-" + shape.key + "-" + bound.key + "-" + context
				host, body, code := "effect", strings.ReplaceAll(shape.call, "%s", bound.text), 0
				if context == "plain" {
					host = "plain"
				}
				if context == "wrapped" {
					body = "try Effect.try(()=>" + body + ")"
				} else if bound.throwing {
					body = "⟦" + body + "⟧"
					code = 403
					if host == "plain" {
						code = 401
					}
				}
				quote := q.inferred
				if code == 403 {
					quote = q.directCall
				} else if code == 401 {
					quote = q.plainPropagates
				}
				add(&failCase{Name: name, Quote: quote, Host: host, Lib: strings.ReplaceAll(shape.lib, "%s", bound.text), Body: body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}
	for _, context := range []string{"effect", "plain", "wrapped"} {
		host, body := "effect", "read()"
		if context == "plain" {
			host = "plain"
		}
		if context == "wrapped" {
			body = "try Effect.try(()=>read())"
		}
		add(&failCase{Name: "throws-generic-default-omitted-" + context, Quote: q.inferred, Host: host, Lib: "/** @throws {T} */\nexport declare function read<T=never>():number", Body: body})
	}

	// Extraction preserves a generic receiver's written contract through const references.
	for _, bound := range []struct {
		key, text string
		throwing  bool
	}{{"never", "never", false}, {"range", "RangeError", true}} {
		for _, binding := range []struct{ key, prefix, call string }{
			{"direct", "", "reader.read(s)"},
			{"alias", "const read=reader.read;", "read(s)"},
			{"chain", "const first=reader.read;const read=first;", "read(s)"},
			{"parenthesized", "const read=((reader.read));", "read(s)"},
			{"element", "const read=reader['read'];", "read(s)"},
			{"nested-member", "const read=nested.reader.read;", "read(s)"},
		} {
			for _, context := range []string{"effect", "plain", "wrapped"} {
				name := "throws-receiver-alias-" + binding.key + "-" + bound.key + "-" + context
				host, body, code := "effect", binding.call, 0
				if context == "plain" {
					host = "plain"
				}
				if context == "wrapped" {
					body = "try Effect.try(()=>" + body + ")"
				} else if bound.throwing {
					body = "⟦" + body + "⟧"
					code = 403
					if host == "plain" {
						code = 401
					}
				}
				quote := q.inferred
				if code == 403 {
					quote = q.directCall
				} else if code == 401 {
					quote = q.plainPropagates
				}
				add(&failCase{Name: name, Quote: quote, Host: host, Lib: "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):unknown\n}\nexport declare const reader:Reader<" + bound.text + ">\nexport declare const nested:{reader:Reader<" + bound.text + ">}", Body: binding.prefix + body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}

	// Destructuring keeps the selected container's generic receiver contract.
	for _, bound := range []struct {
		key, text string
		throwing  bool
	}{{"never", "never", false}, {"range", "RangeError", true}} {
		for _, binding := range []struct{ key, prefix string }{
			{"object", "const {read}=reader;"},
			{"renamed", "const {read:readAlias}=reader;const read=readAlias;"},
			{"nested", "const {reader:{read}}=nested;"},
			{"string-key", "const {'read':read}=reader;"},
			{"computed-key", "const {['read']:read}=reader;"},
			{"nested-array", "const [{read}]=[reader];"},
			{"function-array", "const [read]=[reader.read] as const;"},
			{"function-object", "const {read}={read:reader.read};"},
		} {
			for _, context := range []string{"effect", "plain", "wrapped"} {
				name := "throws-destructured-receiver-" + binding.key + "-" + bound.key + "-" + context
				host, body, code := "effect", "read(s)", 0
				if context == "plain" {
					host = "plain"
				}
				if context == "wrapped" {
					body = "try Effect.try(()=>" + body + ")"
				} else if bound.throwing {
					body = "⟦" + body + "⟧"
					code = 403
					if host == "plain" {
						code = 401
					}
				}
				quote := q.inferred
				if code == 403 {
					quote = q.directCall
				} else if code == 401 {
					quote = q.plainPropagates
				}
				add(&failCase{Name: name, Quote: quote, Host: host, Lib: "export interface Reader<T>{\n/** @throws {T} */\nread(s:string):number\n}\nexport declare const reader:Reader<" + bound.text + ">\nexport declare const nested:{reader:Reader<" + bound.text + ">}", Body: binding.prefix + body, Code: code, OneDiagnostic: code != 0})
			}
		}
	}

	for _, risky := range []bool{false, true} {
		cb, bound := "safe", "never"
		if risky {
			cb, bound = "risky", "range"
		}
		for _, shape := range []struct{ key, prefix, call string }{
			{"direct", "", "invoke(" + cb + ")"},
			{"literal", "", "invoke(...[" + cb + "] as const)"},
			{"stored", "const callbacks=[" + cb + "] as const;", "invoke(...callbacks)"},
			{"mutable", "const callbacks:[typeof " + cb + "]=[" + cb + "];", "invoke(...callbacks)"},
			{"rest", "", "many(...[safe," + cb + "] as const)"},
			{"leading", "", "after(...[1] as const," + cb + ")"},
			{"leading-two", "", "afterTwo(...[1,2] as const," + cb + ")"},
			{"trailing", "", "after(...[1," + cb + "] as const)"},
			{"split", "", "after(...[1] as const,...[" + cb + "] as const)"},
			{"nested", "", "invoke(...[...[" + cb + "] as const] as const)"},
			{"constructor", "", "new Invoke(...[" + cb + "] as const)"},
		} {
			for _, context := range []string{"effect", "plain", "wrapped"} {
				host, body, code := "effect", shape.call, 0
				if context == "plain" {
					host = "plain"
				}
				if context == "wrapped" {
					body = "try Effect.try(() => " + body + ")"
				} else if risky {
					code = 403
					if host == "plain" {
						code = 401
					}
					body = "⟦" + body + "⟧"
				}
				quote := q.rethrows
				if code == 403 {
					quote = q.directCall
				} else if code == 401 {
					quote = q.plainPropagates
				}
				lib := "/** @throws {RangeError} */\nexport declare function risky(n:number):number\n/** @throws {never} */\nexport declare function safe(n:number):number\n" +
					"/** @throws {never}\n * @rethrows cb\n */\nexport declare function invoke(cb:(n:number)=>number):number\n" +
					"/** @throws {never}\n * @rethrows cb\n */\nexport declare function after(prefix:number,cb:(n:number)=>number):number\n" +
					"/** @throws {never}\n * @rethrows cb\n */\nexport declare function afterTwo(first:number,second:number,cb:(n:number)=>number):number\n" +
					"/** @throws {never}\n * @rethrows callbacks\n */\nexport declare function many(...callbacks:((n:number)=>number)[]):number\n" +
					"export declare class Invoke {\n/** @throws {never}\n * @rethrows cb\n */\nconstructor(cb:(n:number)=>number)\n}\n"
				add(&failCase{
					Name:  "rethrows-tuple-spread-" + shape.key + "-" + bound + "-" + context,
					Quote: quote, Lib: lib, Host: host, Body: shape.prefix + body, Code: code, OneDiagnostic: code != 0,
				})
			}
		}
	}

	// Written callback contracts retain their receiver substitutions at rethrowing calls.
	for _, bound := range []struct {
		key, text string
		throwing  bool
	}{{"never", "never", false}, {"range", "RangeError", true}} {
		for _, binding := range []struct{ key, prefix, arg string }{
			{"direct", "", "reader.read"},
			{"alias", "const read=reader.read;", "read"},
			{"chain", "const first=reader.read;const read=first;", "read"},
			{"object", "const {read}=reader;", "read"},
			{"nested", "const {reader:{read}}=nested;", "read"},
		} {
			for _, invoke := range []string{"array", "foreign", "constructor", "tag"} {
				for _, context := range []string{"effect", "plain", "wrapped"} {
					name := "rethrows-receiver-" + invoke + "-" + binding.key + "-" + bound.key + "-" + context
					host, body, code := "effect", "[1].map("+binding.arg+")", 0
					switch invoke {
					case "foreign":
						body = "run(" + binding.arg + ")"
					case "constructor":
						body = "new Invoke(" + binding.arg + ")"
					case "tag":
						body = "tag" + string(rune(96)) + "${" + binding.arg + "}" + string(rune(96))
					}
					if context == "plain" {
						host = "plain"
					}
					if context == "wrapped" {
						body = "try Effect.try(()=>" + body + ")"
					} else if bound.throwing {
						body = "⟦" + body + "⟧"
						code = 403
						if host == "plain" {
							code = 401
						}
					}
					quote := q.rethrows
					if code == 403 {
						quote = q.directCall
					} else if code == 401 {
						quote = q.plainPropagates
					}
					lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:number):number\n}\nexport declare const reader:Reader<" + bound.text + ">\nexport declare const nested:{reader:Reader<" + bound.text + ">}\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function run(cb:(s:number)=>number):number\n" +
						"export declare class Invoke{\n/** @throws {never}\n * @rethrows cb\n */\nconstructor(cb:(s:number)=>number)}\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function tag(parts:TemplateStringsArray,cb:(s:number)=>number):number"
					add(&failCase{Name: name, Quote: quote, Host: host, Lib: lib, Body: binding.prefix + body, Code: code, OneDiagnostic: code != 0})
				}
			}
		}
	}

	// Inferred receiver alternatives must not borrow only the never branch's owner.
	for _, reverse := range []bool{false, true} {
		left, right, order := "safe", "risky", "safe-first"
		if reverse {
			left, right, order = right, left, "risky-first"
		}
		for _, alias := range []bool{false, true} {
			reference, prefix, arg := "direct", "const selected=xs.length>0?"+left+":"+right+";", "selected.read"
			if alias {
				reference = "alias"
				prefix += "const read=selected.read;"
				arg = "read"
			}
			for _, invoke := range []string{"array", "foreign", "constructor", "tag"} {
				for _, context := range []string{"effect", "plain", "wrapped"} {
					name := "rethrows-inferred-receiver-" + order + "-" + reference + "-" + invoke + "-" + context
					host, body, code := "effect", "[1].map("+arg+")", 403
					switch invoke {
					case "foreign":
						body = "run(" + arg + ")"
					case "constructor":
						body = "new Invoke(" + arg + ")"
					case "tag":
						body = "tag" + string(rune(96)) + "${" + arg + "}" + string(rune(96))
					}
					quote := q.directCall
					if context == "plain" {
						host = "plain"
						code = 401
						quote = q.plainPropagates
					}
					if context == "wrapped" {
						body = "try Effect.try(()=>" + body + ")"
						code = 0
						quote = q.rethrows
					} else {
						body = "⟦" + body + "⟧"
					}
					lib := "export interface Reader<T>{\n/** @throws {T} */\nread(n:number):number\n}\nexport declare const safe:Reader<never>\nexport declare const risky:Reader<RangeError>\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function run(cb:(n:number)=>number):number\n" +
						"export declare class Invoke{\n/** @throws {never}\n * @rethrows cb\n */\nconstructor(cb:(n:number)=>number)}\n" +
						"/** @throws {never}\n * @rethrows cb\n */\nexport declare function tag(parts:TemplateStringsArray,cb:(n:number)=>number):number"
					add(&failCase{Name: name, Quote: quote, Host: host, Lib: lib, Body: prefix + body, Code: code, OneDiagnostic: code != 0})
				}
			}
		}
	}
	add(&failCase{Name: "foreign-own-throw-over-type", Quote: "| no tag | `unknown` |", Host: "effect", Body: "⟦read(s)⟧", Lib: "type Reader = (s: string) => string\n/** @throws {Error} */\nexport declare const read: Reader"})
	add(&failCase{Name: "foreign-returned-signature", Quote: "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives.", Host: "effect", Body: "const read = make()\n⟦read(s)⟧", Lib: "/** @throws {never} */\nexport declare function make(): {\n /** @throws {Error} */\n (s: string): string\n}"})
	add(&failCase{Name: "foreign-overload-number", Quote: "Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives.", Host: "effect", Body: "const text = choose(s)\n⟦choose(1)⟧", Lib: "/** @throws {never} */\nexport declare function choose(s: string): string\n/** @throws {RangeError} */\nexport declare function choose(n: number): number"})
	add(&failCase{Name: "effectful-tagged-effect", Quote: q.effectful, Host: "effect", Body: "const value = load()", Lib: "import { Effect, Stream, Layer } from \"effect\"\n/** @throws {Error} */\nexport declare function load(): Effect.Effect<number>"})
	add(&failCase{Name: "effectful-tagged-stream", Quote: q.effectful, Host: "effect", Body: "const value = load()", Lib: "import { Effect, Stream, Layer } from \"effect\"\n/** @throws {Error} */\nexport declare function load(): Stream.Stream<number>"})
	add(&failCase{Name: "effectful-tagged-layer", Quote: q.effectful, Host: "effect", Body: "const value = load()", Lib: "import { Effect, Stream, Layer } from \"effect\"\n/** @throws {Error} */\nexport declare function load(): Layer.Layer<never>"})
	add(&failCase{Name: "assign-unknown-admits", Quote: q.rethrowAccepts, Host: "plain", Body: "const read: Reader = parse", Lib: "/** @throws {Error} */\nexport declare function parse(s: string): string\n" + "export type Reader = {\n /** @throws {unknown} */\n (s: string): string\n}\n"})
	add(&failCase{Name: "schema-error-named-error-struct", Quote: "`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token. `schema error { id: string }` is a schema named `error`: `{` is not the name required after `schema error`.", Host: "none", Decls: "schema error { id: string }\nexport const decoded = Schema.decodeUnknownSync(error)({ id: \"x\" })"})
	// VIP-1/13: vary accessor kind, tag spelling, comments and declaration form.
	for _, form := range []string{"error", "schema error"} {
		for i, member := range []string{"effect get _tag() { return 1 }", "effect get ['_tag']() { return 1 }", "effect /* modifier */ get \"_tag\"() { return 1 }", "effect set _tag(value: string) {}"} {
			add(&failCase{Name: strings.ReplaceAll(form, " ", "-") + fmt.Sprintf("-effect-tag-priority-%d", i), Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`.", Owner: "pmfix-legacy", VIP: 13, Host: "none", Decls: "⟦export " + form + " Bad { " + member + " }⟧", Code: 104, NotCodes: []int{1301, 1302, 1303, 1304, 2117}})
		}
	}
	add(&failCase{Name: "error-priority-tag-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`.", Host: "none", Decls: "⟦export error Bad { _tag = 1 }⟧", Code: 2117, OneDiagnostic: true})
	add(&failCase{Name: "error-priority-static-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`.", Host: "none", Decls: "⟦export error Bad { static x = 1 }⟧", Code: 1302, OneDiagnostic: true})
	// An error extending another error with its own tag gets EK2117 alone;
	// TypeScript's TS2509 on a schema subclass's generated base is the same failure.
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for _, shape := range []struct{ key, base, sub string }{
			{"empty", " {}", " {}"},
			{"fields", " { id: string }", " { code: number }"},
			{"optional", " { id?: string }", " { code?: number }"},
			{"commented", " { /* parent */ id: string }", " { /* child */ code: number }"},
			{"bodyless", "", ""},
			{"getter", " { id: string; get label() { return this.id } }", " { code: number }"},
		} {
			add(&failCase{Name: strings.ReplaceAll(form.prefix, " ", "-") + "-extends-own-tag-" + shape.key,
				Chapter: failuresChapter, VIP: form.vip, Owner: "impl-hunt-fail", Host: "none", Code: 2117, OneDiagnostic: true,
				Quote: "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |",
				Decls: "export " + form.prefix + " NotFound" + shape.base + "\n⟦export " + form.prefix + " UserNotFound extends NotFound" + shape.sub + "⟧"})
		}
	}
	add(&failCase{Name: "error-implements", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "interface Shape {}\n⟦export error Bad implements Shape {}⟧", Code: 1304})
	add(&failCase{Name: "error-default-export", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).", Host: "none", Decls: "⟦export default error Bad⟧", Code: 1305, Owner: "fix-vip-decls"})
	add(&failCase{Name: "schema-error-priority-tag-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`.", Host: "none", Decls: "⟦export schema error Bad { _tag = 1 }⟧", Code: 2117, OneDiagnostic: true})
	add(&failCase{Name: "schema-error-priority-static-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`.", Host: "none", Decls: "⟦export schema error Bad { static x = 1 }⟧", Code: 1302, OneDiagnostic: true})
	add(&failCase{Name: "schema-error-implements", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "interface Shape {}\n⟦export schema error Bad implements Shape {}⟧", Code: 1304})
	add(&failCase{Name: "schema-error-default-export", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).", Host: "none", Decls: "⟦export default schema error Bad⟧", Code: 1305, Owner: "fix-vip-decls"})
	add(&failCase{Name: "error-context-newline", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).", Host: "none", Decls: "const error = 1\nconst Missing = 2\nerror\nMissing\nexport const n = error + Missing"})
	add(&failCase{Name: "interface-local-member", Quote: "| no tag | `unknown` |", Body: "reader.read()", Decls: "interface Reader { read(): string }\ndeclare const reader: Reader"})
	add(&failCase{Name: "effect-decoder-sync-build", Quote: "| `Schema.decodeUnknownSync(Schema.String)` or `Schema.decodeSync(Schema.String)` with a written `@throws {never}` contract | `never` | call directly to build the decoder |", Body: "const decode = Schema.decodeSync(Schema.String)"})
	add(&failCase{Name: "effect-decoder-sync-call", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeSync(Schema.String)\n⟦decode(s)⟧"})
	add(&failCase{Name: "effect-decoder-sync-wrapped", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeSync(Schema.String)\nreturn try Effect.try(() => decode(s))"})
	// VIP-13/VIP-29: vary declaration boundaries, comments and body presence.
	add(&failCase{Name: "error-default-export-body", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default error Missing { id: string }⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "error-default-export-comment", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default /* gap */ error Missing {}⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "error-default-export-newline", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default\nerror Missing⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "error-default-export-contextual", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default error async {}⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "schema-error-default-export-body", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default schema error Missing { id: string }⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "schema-error-default-export-comment", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default /* gap */ schema error Missing {}⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "schema-error-default-export-newline", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default\nschema error Missing⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	add(&failCase{Name: "schema-error-default-export-contextual", Quote: "As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`).", Host: "none", Decls: "⟦export default schema error async {}⟧\nexport const kept = 1", Code: 1305, OneDiagnostic: true, Owner: "impl-hunt-fail"})
	cases = append(cases, failuresForeignGateCases()...)
	cases = append(cases, failuresErrorFamilyCases()...)
	cases = append(cases, failuresReservedMemberCases()...)
	cases = append(cases, failuresSchemaErrorReferenceCases()...)
	cases = append(cases, failuresFieldCommaCases()...)
	cases = append(cases, failuresNominalKeyCases()...)
	cases = append(cases, failuresNominalLiteralKeyCases()...)
	cases = append(cases, coverageCallableAdditionalCases()...)
	return foreignFixtures(append(append(cases, failuresExtraCases()...), failuresNoThrowCases()...))
}

// failuresNotAsserted are the chapter's bullets and rows no case checks,
// each with the reason. Each key must be verbatim in the chapter.
var failuresNotAsserted = map[string]string{
	"| a recognized `error` or `schema error` declaration in an ambient source context, explicit or inherited, as for a [service](005-services.md#static-rules): `declare error Missing`; it comes ahead of the declaration's other diagnostics | `EK1307` |": "asserted in internal/vibelang by TestAmbientErrorDeclaration*, across own declare, namespace and module contexts",
	"| `throw e` means |":                     "table header",
	"| Declaration | Thrown type at a call |": "table header",
	"- **An ordinary `async` parameter list** rejects: a throwing default rejects the returned Promise":                                                    "FuzzNothrowPlacement checks it: its async-default kinds report nothing (nothrowPlacementQuotes[4])",
	"| a `.ts` or JavaScript file, or a `module` body (VIP-40) | JavaScript's `throw`; callers see it through `@throws` ([Thrown types](#thrown-types)) |": "a `.ts` file is the target's Lib, never a host; its throws reach a host only through `@throws`, which the library cases check",
}

// failuresHosts wrap a case's body: Host "effect" is an effect function
// (VIP-1), "plain" and "async" are those functions, "top" the module's top
// level, "none" no host.
func failuresHost(c *failCase, body string) string {
	params := "s: string, xs: number[]"
	switch c.Host {
	case "plain":
		return "export function probe(" + params + ") {\n" + body + "\n  return 0\n}\n"
	case "async":
		return "export async function probe(" + params + ") {\n" + body + "\n  return 0\n}\n"
	case "top":
		return "declare const s: string\ndeclare const xs: number[]\n" + body + "\n"
	case "none":
		return body
	}
	return "export effect function probe(" + params + ") {\n" + body + "\n  return 0\n}\n"
}

// failuresProject writes a case as a project. The choice byte varies what
// the chapter says does not matter: bit 0 moves Decls to helpers.vibe
// (exported and imported), bits 1-2 nest the body in a block, an if or a
// for-of, and bit 3 writes Lib as lib.d.ts instead of lib.ts.
func failuresProject(c *failCase, choice byte) (files map[string]string, span [2]int) {
	files = map[string]string{}
	body := c.Body
	if c.Host != "none" && c.Host != "top" && body != "" && !strings.Contains(body, "return ") {
		switch (choice >> 1) & 3 {
		case 1:
			body = "{\n" + body + "\n}"
		case 2:
			body = "if (s.length >= 0) {\n" + body + "\n}"
		case 3:
			body = "for (const _x of xs) {\n" + body + "\n}"
		}
	}
	var imports []string
	if c.Lib != "" {
		name := "lib.ts"
		if choice&8 != 0 {
			name = "lib.d.ts"
		}
		files[name] = c.Lib
		imports = append(imports, "import { "+strings.Join(exportedNames(c.Lib), ", ")+" } from \"./lib.js\"")
	}
	decls := c.Decls
	if decls != "" && choice&1 != 0 && c.Host != "none" && !strings.Contains(decls, "⟦") {
		helpers := exportAll(decls)
		files["helpers.vibe"] = strings.Join(imports, "\n") + "\n" + helpers + "\n"
		imports = append(imports, "import { "+strings.Join(exportedNames(helpers), ", ")+" } from \"./helpers.vibe\"")
		decls = ""
	}
	text := strings.Join(imports, "\n") + "\n" + decls + "\n" + failuresHost(c, body)
	if i := strings.Index(text, "⟦"); i >= 0 {
		j := strings.Index(text, "⟧")
		span = [2]int{i, j - len("⟦")}
		text = strings.Replace(strings.Replace(text, "⟦", "", 1), "⟧", "", 1)
	} else {
		span = [2]int{-1, -1}
	}
	files["main.vibe"] = text
	return files, span
}

var exportedName = regexp.MustCompile(`(?m)^export (?:declare )?(?:effect |async )?(?:function|const|class|interface|type|error|schema error|schema) (\w+)`)

func exportedNames(text string) []string {
	var names []string
	for _, m := range exportedName.FindAllStringSubmatch(text, -1) {
		if !slices.Contains(names, m[1]) {
			names = append(names, m[1])
		}
	}
	return names
}

// exportAll exports each top-level declaration of a helpers module.
func exportAll(decls string) string {
	lines := strings.Split(decls, "\n")
	for i, line := range lines {
		for _, kw := range []string{"function ", "effect function ", "async function ", "const ", "class ", "type "} {
			if strings.HasPrefix(line, kw) {
				lines[i] = "export " + line
				break
			}
		}
		if strings.HasPrefix(line, "declare const ") {
			lines[i] = "export " + line
		}
	}
	return strings.Join(lines, "\n")
}

const failuresTarget = "FuzzFailuresSpec"

func checkFailures(t *testing.T, w *Workspace, c *failCase, choice byte) {
	t.Helper()
	files, span := failuresProject(c, choice)
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	key := "feature:" + c.Name
	rule := fmt.Sprintf("%s (VIP-%d): %q", c.chapter(), c.VIP, c.Quote)
	var inside, outside []string
	matchedCode := c.Code == 0
	insideCodes := map[int]bool{}
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		text := describe(d)
		if span[0] >= 0 && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") && d.Pos() <= span[1] && d.End() >= span[0] {
			inside = append(inside, text)
			matchedCode = matchedCode || IsEK(d) && int(d.Code()) == c.Code
			if IsEK(d) {
				insideCodes[int(d.Code())] = true
			}
		} else {
			outside = append(outside, text)
		}
	}
	for _, code := range c.AlsoCodes {
		matchedCode = matchedCode && insideCodes[code]
	}
	for _, code := range c.NotCodes {
		matchedCode = matchedCode && !insideCodes[code]
	}
	switch {
	case c.Throws != nil:
		if len(outside) > 0 {
			Gap(t, failuresTarget, key, "%s: the program draws errors %v\n%s", rule, outside, Archive(files))
		}
		if problems := checkThrowsTags(r.Outputs, c.Throws); len(problems) > 0 {
			Gap(t, failuresTarget, key, "%s: %s\n%s", rule, strings.Join(problems, "; "), Archive(files))
		}
	case span[0] >= 0:
		if len(inside) == 0 || len(outside) > 0 || !matchedCode || c.OneDiagnostic && len(inside) != 1 {
			Gap(t, failuresTarget, key, "%s: the chapter rejects the marked code (expected EK%04d, or a TypeScript error for zero; also %v, never %v); errors there: %v, elsewhere: %v\n%s", rule, c.Code, c.AlsoCodes, c.NotCodes, inside, outside, Archive(files))
		}
	default:
		if len(outside) > 0 {
			Gap(t, failuresTarget, key, "%s: the chapter accepts this program; errors: %v\n%s", rule, outside, Archive(files))
		}
	}
	ExpectPending(t, failuresTarget, key)
}

// checkThrowsTags checks that each name's declaration in the emitted
// declaration files carries the given @throws tag, or none for "".
func checkThrowsTags(outputs map[string]string, want map[string]string) []string {
	var decls strings.Builder
	for name, text := range outputs {
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			decls.WriteString(text + "\n")
		}
	}
	text := decls.String()
	var problems []string
	names := make([]string, 0, len(want))
	for name := range want {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		re := regexp.MustCompile(`(?:/\*\*((?:[^*]|\*[^/])*)\*/\s*)?(?:export )?(?:declare )?(?:function |const |get |readonly )?\b` + name + `\b\s*[(:<]`)
		m := re.FindStringSubmatch(text)
		if m == nil {
			problems = append(problems, fmt.Sprintf("no declaration of %s in %q", name, text))
			continue
		}
		comment := m[1]
		// VIP-27 preserves native declaration shapes. A callable const can
		// carry the generated contract on its binding without a type-literal rewrite.

		got := ""
		if tag := regexp.MustCompile(`@throws\s*(\{[^}]+\})`).FindStringSubmatch(comment); tag != nil {
			got = tag[1]
		}
		if tag := regexp.MustCompile(`@rethrows\s+(\w+)`).FindStringSubmatch(comment); tag != nil {
			got += " @rethrows " + tag[1]
		}
		if got != want[name] {
			problems = append(problems, fmt.Sprintf("%s carries @throws %q, want %q", name, got, want[name]))
		}
	}
	return problems
}

// failuresCasesFromSpec validates the oracle even when a campaign selects
// only FuzzFailuresSpec and skips ordinary Test functions.
func failuresCasesFromSpec(t testing.TB) []*failCase {
	t.Helper()
	cases := failuresCases()
	chapters := map[string]string{}
	for _, c := range cases {
		text, ok := chapters[c.chapter()]
		if !ok {
			text = SpecText(c.chapter())
			chapters[c.chapter()] = text
		}
		if !strings.Contains(text, c.Quote) {
			t.Fatalf("%s: %s no longer says %q; review the oracle before generating programs", c.Name, c.chapter(), c.Quote)
		}
	}
	return cases
}

func TestFailuresSpec(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range failuresCasesFromSpec(t) {
		t.Run(c.Name, func(t *testing.T) { checkFailures(t, w, c, 0) })
	}
}

func FuzzFailuresSpec(f *testing.F) {
	startShortBudget(f)
	cases := failuresCasesFromSpec(f)
	for _, c := range cases {
		f.Add(c.Name, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, name string, choice uint8) {
		// The input names its case, so a reproduction keeps its case when
		// cases are added; an unknown name picks one by its length.
		i := slices.IndexFunc(cases, func(c *failCase) bool { return c.Name == name })
		if i < 0 {
			i = len(name) % len(cases)
		}
		checkFailures(t, w, cases[i], choice)
		ExpectPending(t, failuresTarget, specCorpusKey(t))
	})
}

// TestFailuresSpecQuotes checks that each case's quote is still in its
// chapter, so a reworded rule sends its cases back for review.
func TestFailuresSpecQuotes(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range failuresCases() {
		if seen[c.Name] {
			t.Errorf("case %s is listed twice", c.Name)
		}
		seen[c.Name] = true
		if !strings.Contains(SpecText(c.chapter()), c.Quote) {
			t.Errorf("%s: %s no longer says %q", c.Name, c.chapter(), c.Quote)
		}
	}
	for quote := range failuresNotAsserted {
		if !strings.Contains(SpecText(failuresChapter), quote) {
			t.Errorf("%s no longer says %q (failuresNotAsserted)", failuresChapter, quote)
		}
	}
}

// TestFailuresSpecCoverage reads the chapter's bullets and static-rule rows
// and fails when one is quoted by no case and not listed in
// failuresNotAsserted.
func TestFailuresSpecCoverage(t *testing.T) {
	var quotes []string
	for _, c := range failuresCases() {
		if c.chapter() == failuresChapter {
			quotes = append(quotes, c.Quote)
		}
	}
	for q := range failuresNotAsserted {
		quotes = append(quotes, q)
	}
	for _, line := range strings.Split(SpecText(failuresChapter), "\n") {
		if !strings.HasPrefix(line, "- ") && !regexp.MustCompile(`^[0-9]+\. `).MatchString(line) && !(strings.HasPrefix(line, "| ") && !strings.HasPrefix(line, "| ---") && !strings.HasPrefix(line, "| Rule") && !strings.HasPrefix(line, "| Where") && !strings.HasPrefix(line, "| Callable") && !strings.HasPrefix(line, "| Call in effect code")) {
			continue
		}
		covered := slices.ContainsFunc(quotes, func(q string) bool { return strings.Contains(line, q) })
		if !covered {
			t.Errorf("%s: no case quotes %q; add one, or list it in failuresNotAsserted with the reason", failuresChapter, line)
		}
	}
}
