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
		throwEverywhere: "`throw` is allowed everywhere ([Thrown types](#thrown-types) says which calls may throw).",
		jsThrow:         "| a plain or `async` function, or the top level | JavaScript's `throw` |",
		effThrow:        "| effect code | the Effect fails with `e`, a typed error: `return yield* Effect.fail(e)` |",
		effectful:       "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.",
		never:           "1. **Effectful callee:** its thrown type is `never`; neither `@throws` nor `@rethrows` adds synchronous throws.",
		inferred:        "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		async:           "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.",
		asyncArgs:       "- **Arguments** are evaluated by the caller, so their thrown types are the caller's.",
		library:         "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		unknownDefault:  "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		neverTag:        "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		globals:         "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.",
		fnType:          "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		differs:         "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		accessor:        "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.",
		newTracked:      "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.",
		rethrows:        "3. **Rethrows for synchronous callables:** union the own thrown type with the thrown types of the actual callbacks passed for every named `@rethrows` parameter, whichever case in step 2 applied. The tag is written, never inferred. `@throws {never}` describes only the callee's own throws and does not erase `@rethrows f`. Argument-expression evaluation remains the caller's code.",
		rethrowGlobals:  "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.",
		storing:         "Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.",
		wrappersStill:   "A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.",
		effectExports:   "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.",
		decoderBuild:    "const decode = Schema.decodeUnknownSync(Schema.String) // building the decoder throws never",
		assignable:      "As for Swift's non-`throws` function type, a function whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. A parameter named by `@rethrows` admits anything, because the call then throws what its argument throws. So `const r: () => string = parse` is an error (`EK0402`): wrap the function, or annotate the type `@throws`.",
		rethrowWritten:  "3. **Rethrows for synchronous callables:** union the own thrown type with the thrown types of the actual callbacks passed for every named `@rethrows` parameter, whichever case in step 2 applied. The tag is written, never inferred. `@throws {never}` describes only the callee's own throws and does not erase `@rethrows f`. Argument-expression evaluation remains the caller's code.",
		rethrowAccepts:  "As for Swift's non-`throws` function type, a function whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. A parameter named by `@rethrows` admits anything, because the call then throws what its argument throws. So `const r: () => string = parse` is an error (`EK0402`): wrap the function, or annotate the type `@throws`.",
		effectfulBody:   "Because an effectful function can't throw, its own code that runs before the Effect exists may not throw either. In a plain `.vibe` function whose return type is an Effect, a `Stream` or a `Layer`, an uncaught `throw` in its own body (nested functions excluded), or an unwrapped call or class evaluation whose thrown type is not `never`, is an error (`EK0401`): make it an `effect` function, or return `fail(e)`. This follows VIP-4's effectful-callable amendment; its later ‘`try` only in effect code’ amendment removes the old restriction on non-Effect return annotations. The same holds for code an `effect` function runs at the call ([Code outside the generator](#code-outside-the-generator)).",
		defaultInit:     "- **Parameter defaults and destructuring** run at the call, before the Effect exists. An effectful function can't throw, so a default whose thrown type is not `never` is an error (`EK0401`). A default that returns a Promise is a plain value, as in TypeScript. Destructuring a parameter can still throw a `TypeError`, an implicit throw. As an `async` function rejects instead of throwing (ECMA-262 EvaluateAsyncFunctionBody), the call of an `effect` function then gives an Effect that dies with that value, and a producer's gives a `Stream` that dies with it. The call itself never throws. A `.ts` function that returns an Effect keeps its own behavior.",
		implicit:        "`@throws {T}` and `@rethrows p` attach to call signatures, not a `type` alias's declaration: write `type Reader = { /** @throws {Error} */ (): string }`. Contracts travel with signatures: `const g = f` preserves `f`'s thrown type. Declaration output tags exported non-effectful callables ([Declaration output](001-functions.md#declaration-output)). Implicit throws, such as reading a property of `undefined` or a stack overflow, are never tracked; they are defects, as in `Effect.sync`.",
		directCall:      "| In effect code or a plain `catch` handler's parameter/default/destructuring initialization or body, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
		wrapIt:          "| In effect code or a plain `catch` handler's parameter/default/destructuring initialization or body, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`. Wrap it: `try Effect.try(() => parse(s))` | `EK0403` |",
		promiseCall:     "| In effect code, a call (runtime `import()` included), `new` expression, tagged template or `async match` producing a Promise or thenable, even if assigned to a variable and never awaited. Move the expression into a `tryPromise` thunk, whether or not it can reject; `promise` also works when the thunk's thrown type is `never` | `EK0404` |",
		plainPropagates: "A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.",
		asyncRejects:    "A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.",
		callsDirectly:   "A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.",
		promiseReject:   "A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.",
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

	// throw is allowed everywhere; its meaning is the differential's.
	add(&failCase{Name: "throw-effect", Quote: q.effThrow, Body: "if (s.length > 3) throw new Error(\"long\")"})
	add(&failCase{Name: "throw-plain", Quote: q.jsThrow, Host: "plain", Body: "if (s.length > 3) throw new Error(\"long\")"})
	add(&failCase{Name: "throw-async", Quote: q.jsThrow, Host: "async", Body: "if (s.length > 3) throw new Error(\"long\")"})
	add(&failCase{Name: "throw-top", Quote: q.throwEverywhere, Host: "top", Body: "if (Math.max(1, 2) > 3) throw new Error(\"never\")"})

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
	add(&failCase{Name: "wrap-effect-try-nested-callback", Quote: q.wrapIt, Decls: failParse, Body: "const p = try Effect.try(() => xs.map((x) => parse(String(x))))"})
	add(&failCase{Name: "wrap-try-promise-async", Quote: q.promiseCall, Decls: failLater, Body: "const p = try tryPromise(() => later(s))"})
	add(&failCase{Name: "wrap-promise", Quote: q.promiseCall, Decls: failLater, Body: "const p = try promise(() => later(s))"})
	add(&failCase{Name: "nonthrowing-direct", Quote: q.callsDirectly, Decls: failAdd, Body: "add(1, 2)"})

	// Inference from the body.
	add(&failCase{Name: "inferred-transitive", Quote: q.inferred, Decls: failParse + "\nfunction viaParse(s: string) { return parse(s) }", Body: "⟦viaParse(s)⟧"})
	add(&failCase{Name: "inferred-caught", Quote: q.inferred, Decls: failParse + "\nfunction safe(s: string) {\n  try { return parse(s) } catch { return \"\" }\n}", Body: "safe(s)"})
	add(&failCase{Name: "inferred-throw-caught", Quote: q.inferred, Decls: "function safe(s: string) {\n  try { if (!s) throw new Error(\"empty\") } catch { return 0 }\n  return 1\n}", Body: "safe(s)"})
	add(&failCase{Name: "inferred-arrow-const", Quote: q.inferred, Decls: "const parse = (s: string) => { if (!s) throw new Error(\"empty\"); return s }", Body: "⟦parse(s)⟧"})
	add(&failCase{Name: "inferred-uncalled-arrow", Quote: q.inferred, Decls: "function make() { return () => { throw new Error(\"later\") } }", Body: "const f = make()"})
	add(&failCase{Name: "inferred-plain-calls-plain", Quote: q.plainPropagates, Host: "plain", Decls: failParse, Body: "parse(s)"})
	add(&failCase{Name: "inferred-async-calls-throwing", Quote: q.asyncRejects, Host: "async", Decls: failParse, Body: "parse(s)"})

	// async calls: the call never throws; its arguments may.
	add(&failCase{Name: "async-call-in-plain", Quote: q.async, Decls: failLater + "\nfunction start(s: string) { later(s); return 1 }", Body: "start(s)"})
	add(&failCase{Name: "async-arguments", Quote: q.asyncArgs, Decls: failParse + "\n" + failLater + "\nfunction start(s: string) { later(parse(s)); return 1 }", Body: "start(s)"})

	// Effectful callees are never tracked (decided detail 1).
	add(&failCase{Name: "effectful-ts-effect", Quote: q.effectful, Lib: "import { Effect } from \"effect\"\nexport declare function load(s: string): Effect.Effect<number>", Body: "const n = try load(s)"})
	add(&failCase{Name: "effectful-ts-stream", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Lib: "import { Stream } from \"effect\"\nexport declare function lines(s: string): Stream.Stream<string>", Body: "const t = lines(s)"})
	add(&failCase{Name: "effectful-ts-layer", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Lib: "import { Layer } from \"effect\"\nexport declare function live(): Layer.Layer<never>", Body: "const l = live()"})
	add(&failCase{Name: "effectful-vibe-stream", Quote: "function stream(text: string) { return Stream.succeed(text) }", Decls: "function stream(text: string) { return Stream.succeed(text) }", Body: "const t = stream(s)"})
	add(&failCase{Name: "effectful-vibe-layer", Quote: "function layer() { return Layer.empty }", Decls: "function layer() { return Layer.empty }", Body: "const l = layer()"})
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
	add(&failCase{Name: "library-plain-propagates", Quote: q.plainPropagates, Host: "plain", Lib: lib, Body: "range(s)\nplain(s)"})
	add(&failCase{Name: "global-json-parse", Quote: "| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |", Body: "const v: unknown = ⟦JSON.parse(s)⟧"})
	add(&failCase{Name: "global-json-parse-wrapped", Quote: "| `JSON.parse(s)` | `SyntaxError` | `try Effect.try(() => JSON.parse(s))` |", Body: "const v: unknown = try Effect.try(() => JSON.parse(s))"})
	add(&failCase{Name: "global-math-max", Quote: "| `Math.max(1, 2)` | `never` | call directly |", Body: "const top = Math.max(...xs)"})
	add(&failCase{Name: "effect-option-some", Quote: "| `Option.some(1)` | `never` | call directly |", Body: "const o = Option.some(s)"})
	add(&failCase{Name: "effect-decode-sync", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const v = ⟦Schema.decodeUnknownSync(Schema.String)(s)⟧"})
	add(&failCase{Name: "effect-decode-sync-wrapped", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const v = try Effect.try(() => Schema.decodeUnknownSync(Schema.String)(s))"})
	add(&failCase{Name: "effect-decoder-build", Quote: "| `Schema.decodeUnknownSync(Schema.String)` or `Schema.decodeSync(Schema.String)` | `never` | call directly to build the decoder |", Body: "const decode = Schema.decodeUnknownSync(Schema.String)"})
	add(&failCase{Name: "effect-decoder-call", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeUnknownSync(Schema.String)\nconst v = ⟦decode(s)⟧"})
	add(&failCase{Name: "effect-decoder-call-wrapped", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeUnknownSync(Schema.String)\nreturn try Effect.try(() => decode(s))"})

	// Function types and interface members (decided detail 3).
	add(&failCase{Name: "function-type-parameter", Quote: q.fnType, Decls: "function run(f: () => string) { return f() }", Body: "run(() => \"x\")"})
	add(&failCase{Name: "function-type-alias", Quote: q.fnType, Decls: "type Reader = () => string\nfunction run(f: Reader) { return f() }", Body: "run(() => \"x\")"})
	add(&failCase{Name: "interface-member", Quote: q.library, Lib: "export interface Reader { read(): string }\nexport declare const reader: Reader\n", Body: "⟦reader.read()⟧"})
	add(&failCase{Name: "interface-member-opts-in", Quote: q.fnType, Lib: "export interface Reader {\n  /** @throws {RangeError} */\n  read(): string\n}\nexport declare const reader: Reader\n", Body: "⟦reader.read()⟧"})
	add(&failCase{Name: "function-type-opts-in", Quote: q.fnType, Decls: "type Reader = {\n  /** @throws {RangeError} */\n  (): string\n}\nfunction run(f: Reader) { return f() }", Body: "⟦run(() => \"x\")⟧"})

	// Swift's assignability rule. The rule is about types, so the cases
	// stand in a plain function and need no effect function.
	add(&failCase{Name: "assign-throwing", Quote: q.assignable, Host: "plain", Decls: failParse, Body: "⟦const r: (s: string) => string = parse⟧"})
	add(&failCase{Name: "assign-throwing-argument", Quote: q.assignable, Host: "plain", Decls: failParse + "\nfunction run(f: () => string) { return f() }", Body: "run(⟦() => parse(s)⟧)"})
	add(&failCase{Name: "assign-annotated-type", Quote: q.assignable, Host: "plain", Decls: failParse + "\ntype Reader = {\n  /** @throws {Error} */\n  (s: string): string\n}", Body: "const r: Reader = parse"})
	add(&failCase{Name: "assign-wrapped", Quote: q.assignable, Host: "plain", Decls: failParse, Body: "const r: () => string = () => {\n  try { return parse(s) } catch { return \"\" }\n}"})

	// Constructors and accessors (decided detail 5).
	add(&failCase{Name: "new-tracked", Quote: q.newTracked, Decls: failInput, Body: "const i = ⟦new Input(s)⟧"})
	add(&failCase{Name: "new-wrapped", Quote: q.newTracked, Decls: failInput, Body: "const i = try Effect.try(() => new Input(s))"})
	add(&failCase{Name: "getter-untracked", Quote: q.accessor, Decls: failInput + "\ndeclare const input: Input", Body: "const v = input.value"})
	add(&failCase{Name: "setter-untracked", Quote: q.accessor, Decls: "class Box {\n  n = 0\n  set value(v: number) { if (v < 0) throw new Error(\"negative\"); this.n = v }\n}\ndeclare const box: Box", Body: "box.value = xs.length"})

	// @rethrows (decided detail 4).
	add(&failCase{Name: "rethrows-throwing", Quote: q.rethrows, Decls: failParse + "\n" + failInvoke, Body: "⟦invoke(() => parse(s))⟧"})
	add(&failCase{Name: "rethrows-nonthrowing", Quote: q.rethrows, Decls: failInvoke, Body: "invoke(() => s)"})
	add(&failCase{Name: "rethrows-accepts-throwing", Quote: q.rethrowAccepts, Host: "plain", Decls: failParse + "\n" + failInvoke, Body: "invoke(() => parse(s))"})
	add(&failCase{Name: "rethrows-not-inferred", Quote: q.rethrowWritten, Host: "plain", Decls: failParse + "\nfunction each(xs: string[], f: (s: string) => void) { xs.forEach(f) }", Body: "each(xs.map(String), ⟦(x) => { parse(x) }⟧)"})
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
	add(&failCase{Name: "declaration-throws", Chapter: "001-functions.md", VIP: 27, Quote: "- **Thrown types.** Each declaration carries its thrown type as [Thrown types](003-failures.md#thrown-types) defines it. An effectful function carries no `@throws`. Every other call signature the output emits carries `@throws {T}`, `@throws {never}` included, so no reader depends on a default: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias (decided detail 66). A bare function type (`() => string`) stays a function type. Getters and setters carry none.",
		Host:   "none",
		Decls:  "export error BadInput\nexport function parse(s: string) { if (!s) throw new BadInput(); return s }\nexport const add = (a: number, b: number) => a + b\nexport class Id {\n  constructor(readonly s: string) { if (!s) throw new BadInput() }\n  get size() { return this.s.length }\n}",
		Throws: map[string]string{"parse": "{BadInput}", "add": "{never}", "constructor": "{BadInput}", "size": ""}})
	add(&failCase{Name: "declaration-effectful", Chapter: "001-functions.md", VIP: 27, Quote: "- **Thrown types.** Each declaration carries its thrown type as [Thrown types](003-failures.md#thrown-types) defines it. An effectful function carries no `@throws`. Every other call signature the output emits carries `@throws {T}`, `@throws {never}` included, so no reader depends on a default: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias (decided detail 66). A bare function type (`() => string`) stays a function type. Getters and setters carry none.",
		Host:   "none",
		Decls:  "export effect function load(id: string) { if (!id) throw new Error(\"empty\"); return id }\nexport function users(ids: string[]) { return Stream.fromIterable(ids) }",
		Throws: map[string]string{"load": "", "users": ""}})
	add(&failCase{Name: "declaration-async", Chapter: "001-functions.md", VIP: 27, Quote: "- **Thrown types.** Each declaration carries its thrown type as [Thrown types](003-failures.md#thrown-types) defines it. An effectful function carries no `@throws`. Every other call signature the output emits carries `@throws {T}`, `@throws {never}` included, so no reader depends on a default: functions, methods, constructors, callable `const`s, `async` functions, and each call, construct or method signature of an exported `interface`, type literal or `type` alias (decided detail 66). A bare function type (`() => string`) stays a function type. Getters and setters carry none.",
		Host:   "none",
		Decls:  "export async function get(q: string) { if (!q) throw new Error(\"empty\"); return q }",
		Throws: map[string]string{"get": "{never}"}})
	add(&failCase{Name: "declaration-rethrows", Chapter: "001-functions.md", VIP: 27, Quote: "- **`@rethrows` is copied and adds to own throws.** A source `/** @rethrows <param> */` tag (VIP-4) is written, never inferred, and the output copies it. For a non-effectful callable, first determine its own thrown type: a written checked bound, else a shipped signature annotation, else local body inference or the foreign/type-position default. Shipped annotations are installed before defaults apply. At each call, union that type with the thrown types of the arguments for every `@rethrows` parameter (decided detail 66). Thus `@throws {never}` describes only own throws; it does not erase `@rethrows f`. Effectful callables have synchronous thrown type `never`, and `@rethrows` adds nothing.",
		Host:   "none",
		Decls:  "/** @rethrows f */\nexport function each(xs: string[], f: (s: string) => void) { xs.forEach(f) }",
		Throws: map[string]string{"each": "{never} @rethrows f"}})

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
	add(&failCase{Name: "schema-error-named-error", VIP: 29, Owner: "fix-vip-decls", Host: "none", Quote: "`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token. `schema error { id: string }` is a schema named `error`: `{` is not the name required after `schema error`.",
		Decls: "schema error = \"a\" | \"b\"\nexport schema error NotFound { id: string }\nexport const n = new NotFound({ id: \"x\" })\nexport const e = Schema.decodeUnknownSync(error)(\"a\")"})
	add(&failCase{Name: "assign-object-member", Quote: "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`). VIP-4's two wrappers declare their thunk parameter `@throws {unknown}` ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)), in both overloads: the function argument or the options object's `try` property. Thus `Effect.try(() => parse(s))` and `tryPromise(() => queryDb(q))` are allowed, and the wrapper turns a throw into a failure. The options object's `catch` callback has the ordinary non-throwing function type; a tracked throw there is rejected, while an implicit throw is a defect. Effect's `LazyArg` and other callback parameter types, including those in `.d.ts` files, describe what an argument callback may throw; without `@throws`, they admit only `never`. This admission rule does not change the foreign-callable default: calling an unannotated foreign function-typed property still throws `unknown`. Every other function parameter admits only what its type says: `sync(() => parse(s))` is an error, so wrap the call with `Effect.try`.", Host: "plain", Body: "⟦const r: { read: (s: string) => string } = { read: parse }⟧", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }"})
	add(&failCase{Name: "wrapper-catch-throw", Quote: "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`). VIP-4's two wrappers declare their thunk parameter `@throws {unknown}` ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)), in both overloads: the function argument or the options object's `try` property. Thus `Effect.try(() => parse(s))` and `tryPromise(() => queryDb(q))` are allowed, and the wrapper turns a throw into a failure. The options object's `catch` callback has the ordinary non-throwing function type; a tracked throw there is rejected, while an implicit throw is a defect. Effect's `LazyArg` and other callback parameter types, including those in `.d.ts` files, describe what an argument callback may throw; without `@throws`, they admit only `never`. This admission rule does not change the foreign-callable default: calling an unannotated foreign function-typed property still throws `unknown`. Every other function parameter admits only what its type says: `sync(() => parse(s))` is an error, so wrap the call with `Effect.try`.", Host: "plain", Body: "Effect.try({ try: () => s, catch: ⟦() => { throw new Error(\"bad\") }⟧ })"})
	add(&failCase{Name: "wrapper-sync-throw", Quote: "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members, class overrides and `implements`. An overriding or implementing method may throw only what the base or interface signature admits (`EK0402`). VIP-4's two wrappers declare their thunk parameter `@throws {unknown}` ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)), in both overloads: the function argument or the options object's `try` property. Thus `Effect.try(() => parse(s))` and `tryPromise(() => queryDb(q))` are allowed, and the wrapper turns a throw into a failure. The options object's `catch` callback has the ordinary non-throwing function type; a tracked throw there is rejected, while an implicit throw is a defect. Effect's `LazyArg` and other callback parameter types, including those in `.d.ts` files, describe what an argument callback may throw; without `@throws`, they admit only `never`. This admission rule does not change the foreign-callable default: calling an unannotated foreign function-typed property still throws `unknown`. Every other function parameter admits only what its type says: `sync(() => parse(s))` is an error, so wrap the call with `Effect.try`.", Host: "plain", Body: "sync(⟦() => parse(s)⟧)", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }"})
	add(&failCase{Name: "wrapper-promise-throw", Quote: "A plain function may propagate a JavaScript throw; an `async` function turns it into rejection. Effect code calls a function whose thrown type is `never` directly. Promise-producing calls inside wrapper thunks are ordinary JavaScript; wrapping never exempts a platform call from [VIP-33](../vips/0033-platform-stdlib.md). `Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code. An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk under the wrapper annotations above.", Host: "plain", Body: "promise(⟦() => { throw new Error(\"bad\") }⟧)"})
	add(&failCase{Name: "wrapper-trypromise-options", Quote: "- **Wrapper thunks** run inside the Effect: their throws become what the wrapper makes of them.", Host: "effect", Body: "const p = try tryPromise({ try: () => { if (!s) throw new Error(\"bad\"); return Promise.resolve(s) }, catch: (e) => e })"})
	add(&failCase{Name: "catch-tracked-call", Quote: "A `service` member is an interface member for throw tracking (detail 3): without `@throws` it admits only `never`; an implementation whose member may throw is `EK0402`.", Host: "effect", Body: "Effect.fail(new Error(\"input\")) catch (e) => ⟦parse(s)⟧", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }"})
	add(&failCase{Name: "catch-tracked-call-wrapped", Quote: "A `service` member is an interface member for throw tracking (detail 3): without `@throws` it admits only `never`; an implementation whose member may throw is `EK0402`.", Host: "effect", Body: "return Effect.fail(new Error(\"input\")) catch effect (e) => try Effect.try(() => parse(s))", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }"})
	add(&failCase{Name: "catch-explicit-throw", Quote: "A `service` member is an interface member for throw tracking (detail 3): without `@throws` it admits only `never`; an implementation whose member may throw is `EK0402`.", Host: "effect", Body: "return Effect.fail(new Error(\"input\")) catch (e) => { throw e }"})
	add(&failCase{Name: "foreign-const", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "effect", Body: "⟦foreign(s)⟧", Lib: "export declare const foreign: (s: string) => string"})
	add(&failCase{Name: "foreign-method", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "effect", Body: "⟦foreign.read(s)⟧", Lib: "export declare class Reader { read(s: string): string }\nexport declare const foreign: Reader"})
	add(&failCase{Name: "foreign-overload", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "effect", Body: "⟦foreign(s)⟧", Lib: "export declare function foreign(s: string): string\nexport declare function foreign(s: number): number"})
	add(&failCase{Name: "dynamic-any", Quote: "Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.", Host: "effect", Body: "⟦f(s)⟧", Decls: "declare const f: any"})
	add(&failCase{Name: "dynamic-function", Quote: "Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.", Host: "effect", Body: "⟦f(s)⟧", Decls: "declare const f: Function"})
	add(&failCase{Name: "effectful-mixed-return", Quote: "Only a return type other than `never`, wholly consisting of Effects, `Stream`s or `Layer`s, is effectful. `never`, `any`, `unknown` and unions containing a non-effectful member, such as `Effect.Effect<number> | undefined`, remain throw-tracked (decided detail 36).", Host: "effect", Body: "⟦uncertain(s)⟧", Decls: "function uncertain(s: string): Effect.Effect<number> | undefined { if (!s) throw new Error(\"empty\"); return undefined }"})
	add(&failCase{Name: "effectful-any-return", Quote: "Only a return type other than `never`, wholly consisting of Effects, `Stream`s or `Layer`s, is effectful. `never`, `any`, `unknown` and unions containing a non-effectful member, such as `Effect.Effect<number> | undefined`, remain throw-tracked (decided detail 36).", Host: "effect", Body: "⟦uncertain(s)⟧", Decls: "function uncertain(s: string): any { if (!s) throw new Error(\"empty\"); return 1 }"})
	add(&failCase{Name: "effectful-error-value", Quote: "1. **Effectful callee:** its thrown type is `never`; neither `@throws` nor `@rethrows` adds synchronous throws.", Host: "effect", Body: "missing()", Decls: "error Missing\nfunction missing() { return new Missing() }"})
	add(&failCase{Name: "error-new-never", Quote: "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.", Host: "effect", Body: "const m = new Missing()", Decls: "error Missing"})
	add(&failCase{Name: "schema-error-new-never", Quote: "A generated `schema error` constructor has thrown type `never`, a static contract (detail 42). Effect 4.1.0 validates its fields; invalid input can throw a plain `Error`, which becomes a defect inside `Effect.gen`.", Host: "effect", Body: "const m = new Missing({ id: s })", Decls: "schema error Missing { id: string }"})
	add(&failCase{Name: "recursive-never", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "effect", Body: "const n = fib(xs.length)", Decls: "function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2) }"})
	add(&failCase{Name: "recursive-throw", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "effect", Body: "⟦walk(xs.length)⟧", Decls: "function walk(n: number): void { if (n) walk(n - 1); else throw new Error(\"end\") }"})
	add(&failCase{Name: "mutual-recursive-throw", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "effect", Body: "⟦a(xs.length)⟧", Decls: "function a(n: number): void { if (n) b(n - 1) }\nfunction b(n: number): void { if (n) a(n - 1); else throw new Error(\"end\") }"})
	add(&failCase{Name: "throws-upper-bound", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "none", Decls: "/** @throws {never} */\nexport function bad() { ⟦throw new Error(\"bad\")⟧ }"})
	add(&failCase{Name: "constructor-field-throw", Quote: "- **Instance field initializers** run in `new X()`, so their thrown types belong to the constructor. With no written derived constructor, include the implicit `super(...args)` call.", Host: "effect", Body: "⟦new Input()⟧", Decls: "function parse() { throw new Error(\"empty\") }\nclass Input { value = parse() }"})
	add(&failCase{Name: "default-promise", Quote: "- **Parameter defaults and destructuring** run at the call, before the Effect exists. An effectful function can't throw, so a default whose thrown type is not `never` is an error (`EK0401`). A default that returns a Promise is a plain value, as in TypeScript. Destructuring a parameter can still throw a `TypeError`, an implicit throw. As an `async` function rejects instead of throwing (ECMA-262 EvaluateAsyncFunctionBody), the call of an `effect` function then gives an Effect that dies with that value, and a producer's gives a `Stream` that dies with it. The call itself never throws. A `.ts` function that returns an Effect keeps its own behavior.", Host: "none", Decls: "async function resolved() { return 1 }\nexport effect function probe(p = resolved()) { return p }"})
	add(&failCase{Name: "error-rejected-initializer", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export error Bad { id = 1 }⟧"})
	add(&failCase{Name: "error-rejected-private-field", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export error Bad { private id: string }⟧"})
	add(&failCase{Name: "error-rejected-index-signature", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export error Bad { [key: string]: number }⟧"})
	add(&failCase{Name: "schema-error-rejected-initializer", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export schema error Bad { id = 1 }⟧"})
	add(&failCase{Name: "schema-error-rejected-private-field", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export schema error Bad { private id: string }⟧"})
	add(&failCase{Name: "schema-error-rejected-index-signature", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "⟦export schema error Bad { [key: string]: number }⟧"})
	add(&failCase{Name: "tagged-template-throw", Quote: "This section is the one definition of throw tracking; every other chapter refers to it. Every call, `new` expression, tagged template and class declaration or expression has a *thrown type*: what it may throw synchronously, or `never`. Tracking applies only to non-effectful callables (VIP-4, amended: \"an effectful function literally cannot throw\").", Host: "effect", Body: "const value = ⟦tag`literal`⟧", Decls: "function tag(parts: TemplateStringsArray) { throw new Error(\"bad\") }"})
	add(&failCase{Name: "tagged-template-never", Quote: "This section is the one definition of throw tracking; every other chapter refers to it. Every call, `new` expression, tagged template and class declaration or expression has a *thrown type*: what it may throw synchronously, or `never`. Tracking applies only to non-effectful callables (VIP-4, amended: \"an effectful function literally cannot throw\").", Host: "effect", Body: "const value = tag`literal`", Decls: "function tag(parts: TemplateStringsArray) { return parts[0] }"})
	add(&failCase{Name: "callable-union-throw", Quote: "Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.", Host: "effect", Body: "⟦f(s)⟧", Decls: "function bad(s: string) { throw new Error(s) }\nfunction safe(s: string) { return s }\ndeclare const cond: boolean\nconst f = cond ? bad : safe"})
	add(&failCase{Name: "written-throws-caller", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "effect", Body: "⟦parse(s)⟧", Decls: "/** @throws {Error} */\nfunction parse(s: string) { return s }"})
	add(&failCase{Name: "throws-upper-bound-ok", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "none", Decls: "/** @throws {Error} */\nexport function parse(s: string) { if (!s) throw new RangeError(\"empty\"); return s }"})
	add(&failCase{Name: "effectful-unknown-return", Quote: "Only a return type other than `never`, wholly consisting of Effects, `Stream`s or `Layer`s, is effectful. `never`, `any`, `unknown` and unions containing a non-effectful member, such as `Effect.Effect<number> | undefined`, remain throw-tracked (decided detail 36).", Host: "effect", Body: "⟦uncertain(s)⟧", Decls: "function uncertain(s: string): unknown { if (!s) throw new Error(\"bad\"); return 1 }"})
	add(&failCase{Name: "effectful-whole-union", Quote: "Only a return type other than `never`, wholly consisting of Effects, `Stream`s or `Layer`s, is effectful. `never`, `any`, `unknown` and unions containing a non-effectful member, such as `Effect.Effect<number> | undefined`, remain throw-tracked (decided detail 36).", Host: "effect", Body: "const value = uncertain(s)", Lib: "import { Effect, Stream } from \"effect\"\nexport declare function uncertain(s: string): Effect.Effect<number> | Stream.Stream<number>"})
	add(&failCase{Name: "error-empty-elements", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export error Missing { id: string; ; get message() { return this.id }; }"})
	add(&failCase{Name: "schema-error-empty-elements", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export schema error Missing { id: string; ; get message() { return this.id }; }"})
	add(&failCase{Name: "error-explicit-readonly", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export error Missing { readonly id: string }\nexport const m = new Missing({ id: \"x\" })"})
	add(&failCase{Name: "schema-error-explicit-readonly", Quote: "[ErrorDeclaration](900-appendices.md#errordeclaration), with an [ErrorBody](900-appendices.md#errorbody) of [Field](900-appendices.md#field)s and methods: [ClassMethod](900-appendices.md#classmethod) (ordinary TypeScript class methods, including plain and `async` overload signatures, generator and `async` generator implementations, getters, setters and private names), with TypeScript's class modifiers, decorators, overload ordering, adjacent-implementation and compatibility checks, plus [effect methods](900-appendices.md#effectmethod) and [producer methods](900-appendices.md#producermethod), as any class can have (VIP-13). A setter parses as a [ClassMethod](900-appendices.md#classmethod) and the static rules below reject it. [Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are shared with `schema` and `data`, so adjacent fields on one line need a separator. The field type is parsed greedily as a TypeScript type member: a line break separates members only after the type is complete. An explicit `readonly` is allowed and redundant. Empty `;` class elements between members are ignored, as in TypeScript.", Host: "none", Decls: "export schema error Missing { readonly id: string }\nexport const m = new Missing({ id: \"x\" })"})
	add(&failCase{Name: "never-return-throw", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Decls: "function boom(): never { throw new Error(\"bad\") }", Body: "⟦boom()⟧"})

	add(&failCase{Name: "declaration-global-throws", Quote: "<a id=\"async-contracts\"></a>An ordinary nongenerator `async` callable declared in `.vibe` has synchronous thrown type `never`: its body, parameter/default initialization and callback throws reject its Promise. This applies to declarations, methods and arrows, but not async generators. A source `@rethrows` parameter still admits arbitrary throwing callbacks. In declaration output, preserve that admission on the parameter's callable signature with `@throws {unknown}`, emit callee `@throws {never}`, and omit an active synchronous `@rethrows` tag. Merely dropping the tag loses callback admission; copying it unchanged invents synchronous throws after `async` is erased. Normalize aliases and sidecars alike, using a local annotated parameter type instead of mutating a shared type alias. A returned callable keeps its own thrown contract. A Promise-returning plain function can instead throw synchronously before returning; its ordinary own-throws and rethrows contracts remain. A Promise return type alone does not establish the async rule. Promise construction separately catches executor throws, as specified below. Getters and setters are not tracked calls. Constructing an `error` or `data` variant throws `never`; their generated constructors do not throw for well-typed input in Effect 4.1.0. An Effect API overload returning an Effect is effectful. A data-last overload such as `map(f)` returns a function: it is non-effectful, with shipped `@throws {never}` when it only builds that function (detail 40). The returned callable has its own signature contract; the shipped rethrowing array methods are `Array.prototype` methods and `Array.from`, not those Effect globals.", Host: "none", Decls: "export function decode(s: string) { return JSON.parse(s) }\nexport function largest(xs: number[]) { return Math.max(...xs) }", Throws: map[string]string{"decode": "{SyntaxError}", "largest": "{never}"}})
	add(&failCase{Name: "declaration-transitive-throws", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "none", Decls: "export error BadInput\nexport function parse(s: string) { if (!s) throw new BadInput(); return s }\nexport function indirect(s: string) { return parse(s) }", Throws: map[string]string{"parse": "{BadInput}", "indirect": "{BadInput}"}})
	add(&failCase{Name: "declaration-recursive-throws", Quote: "Recursive and mutually recursive plain functions infer the least fixed point of their thrown types, starting from `never`: `fib` below throws `never`, `walk` throws `Error`. If an expanding recursive summary cannot reach a finite representable stable contract within the pinned checker's recursion, instantiation or representation bounds, widen the affected strongly connected component's inferred thrown summary to `unknown` and emit `@throws {unknown}`. The same rule applies to mutual recursion. Never truncate the union or emit an invalid circular alias. A written checked upper bound, including `unknown`, cuts the corresponding inference dependency and is checked normally. Independent source type errors still receive TypeScript's ordinary diagnostics; this fallback applies only to inferred throws. A written `@throws {T}` is a checked upper bound: the body may throw only subtypes of `T` (otherwise `EK0405`), callers see `T`, and declaration output copies the tag (detail 45).", Host: "none", Decls: "export function walk(n: number): void { if (n) walk(n - 1); else throw new Error(\"end\") }", Throws: map[string]string{"walk": "{Error}"}})
	add(&failCase{Name: "foreign-declared-type-never", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "effect", Body: "read(s)", Lib: "type Reader = {\n /** @throws {never} */\n (s: string): string\n}\nexport declare const read: Reader"})
	add(&failCase{Name: "foreign-own-tag-over-type", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "effect", Body: "read(s)", Lib: "type Reader = {\n /** @throws {Error} */\n (s: string): string\n}\n/** @throws {never} */\nexport declare const read: Reader"})
	add(&failCase{Name: "foreign-own-throw-over-type", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Host: "effect", Body: "⟦read(s)⟧", Lib: "type Reader = (s: string) => string\n/** @throws {Error} */\nexport declare const read: Reader"})
	add(&failCase{Name: "foreign-returned-signature", Quote: "Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.", Host: "effect", Body: "const read = make()\n⟦read(s)⟧", Lib: "/** @throws {never} */\nexport declare function make(): {\n /** @throws {Error} */\n (s: string): string\n}"})
	add(&failCase{Name: "foreign-overload-number", Quote: "Contracts attach to each call signature, including each overload and a returned callable's own signature; declaration output preserves them (decided details 37–38). Calls through `any` or `Function` throw `unknown`; callable unions combine their alternatives' thrown types (detail 44). TypeScript still requires narrowing `unknown` before calling it.", Host: "effect", Body: "const text = choose(s)\n⟦choose(1)⟧", Lib: "/** @throws {never} */\nexport declare function choose(s: string): string\n/** @throws {RangeError} */\nexport declare function choose(n: number): number"})
	add(&failCase{Name: "rethrows-own-throw", Quote: "3. **Rethrows for synchronous callables:** union the own thrown type with the thrown types of the actual callbacks passed for every named `@rethrows` parameter, whichever case in step 2 applied. The tag is written, never inferred. `@throws {never}` describes only the callee's own throws and does not erase `@rethrows f`. Argument-expression evaluation remains the caller's code.", Host: "effect", Body: "⟦invoke(() => 1)⟧", Decls: "/** @rethrows callback */\nfunction invoke(callback: () => number) { if (Math.max(0, 1)) throw new Error(\"own\"); return callback() }"})
	add(&failCase{Name: "effectful-tagged-effect", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Host: "effect", Body: "const value = load()", Lib: "import { Effect, Stream, Layer } from \"effect\"\n/** @throws {Error} */\nexport declare function load(): Effect.Effect<number>"})
	add(&failCase{Name: "effectful-tagged-stream", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Host: "effect", Body: "const value = load()", Lib: "import { Effect, Stream, Layer } from \"effect\"\n/** @throws {Error} */\nexport declare function load(): Stream.Stream<number>"})
	add(&failCase{Name: "effectful-tagged-layer", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Host: "effect", Body: "const value = load()", Lib: "import { Effect, Stream, Layer } from \"effect\"\n/** @throws {Error} */\nexport declare function load(): Layer.Layer<never>"})
	add(&failCase{Name: "effectful-rethrows-exempt", Quote: "A callable is *effectful* when its return type, written or inferred, is an Effect, a `Stream` or a `Layer`: an `effect` function or producer, Effect's own `sleep`, `sync`, `tryPromise` and `Effect.try`, a service member typed as an Effect, a `.ts` function whose return type is `Effect`. Except for `never`, `any` and `unknown` (below), ‘an Effect’ uses the [Running Effects](002-running.md#try) test: assignability to `Effect.Effect<any, any, any>`; the other tests are assignability to `Stream.Stream<any, any, any>` or `Layer.Layer<any, any, any>`. In Effect 4.1.0 this includes `error` instances, service keys and references; a plain function returning one is effectful and may not throw. Its thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel. This is a static contract, not a JavaScript runtime guarantee: a `.ts` implementation that throws before returning produces a defect when evaluated inside an Effect generator, but a JavaScript exception at the call when evaluated in a parameter default, before the Effect exists.", Host: "effect", Body: "const value = load(() => { throw new Error(\"callback\") })", Lib: "import { Effect } from \"effect\"\ntype Callback = {\n /** @throws {unknown} */\n (): number\n}\n/** @throws {Error} @rethrows callback */\nexport declare function load(callback: Callback): Effect.Effect<number>"})
	add(&failCase{Name: "assign-unknown-admits", Quote: "As for Swift's non-`throws` function type, a function whose thrown type is `T` is assignable to a function type only when that type admits `T`: a type without `@throws` admits only `never`, `@throws {U}` admits subtypes of `U`, and `@throws {unknown}` admits anything. A parameter named by `@rethrows` admits anything, because the call then throws what its argument throws. So `const r: () => string = parse` is an error (`EK0402`): wrap the function, or annotate the type `@throws`.", Host: "plain", Body: "const read: Reader = parse", Decls: "function parse(s: string) { if (!s) throw new Error(\"empty\"); return s }\ntype Reader = {\n /** @throws {unknown} */\n (s: string): string\n}"})
	add(&failCase{Name: "schema-error-named-error-struct", Quote: "`schema error NotFound {` and a schema named `error` (`schema error = …`) differ at the next token. `schema error { id: string }` is a schema named `error`: `{` is not the name required after `schema error`.", Host: "none", Decls: "schema error { id: string }\nexport const decoded = Schema.decodeUnknownSync(error)({ id: \"x\" })"})
	add(&failCase{Name: "error-priority-tag-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`. Otherwise a member gets one diagnostic: the first row that names it. The last row applies only when no other row applies. For example, `_tag = 1` reports `EK2117`; `static x = 1` reports the static-member rule, not the general member rule.", Host: "none", Decls: "⟦export error Bad { _tag = 1 }⟧", Code: 2117, OneDiagnostic: true})
	add(&failCase{Name: "error-priority-static-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`. Otherwise a member gets one diagnostic: the first row that names it. The last row applies only when no other row applies. For example, `_tag = 1` reports `EK2117`; `static x = 1` reports the static-member rule, not the general member rule.", Host: "none", Decls: "⟦export error Bad { static x = 1 }⟧", Code: 1302, OneDiagnostic: true})
	add(&failCase{Name: "error-implements", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "interface Shape {}\n⟦export error Bad implements Shape {}⟧", Code: 1304})
	add(&failCase{Name: "error-default-export", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).", Host: "none", Decls: "⟦export default error Bad⟧", Code: 1305, Owner: "fix-vip-decls"})
	add(&failCase{Name: "schema-error-priority-tag-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`. Otherwise a member gets one diagnostic: the first row that names it. The last row applies only when no other row applies. For example, `_tag = 1` reports `EK2117`; `static x = 1` reports the static-member rule, not the general member rule.", Host: "none", Decls: "⟦export schema error Bad { _tag = 1 }⟧", Code: 2117, OneDiagnostic: true})
	add(&failCase{Name: "schema-error-priority-static-initializer", Quote: "A member rejected by [Functions](001-functions.md#static-rules) for `effect` on a getter, setter or constructor gets the applicable Functions diagnostics and no redundant error-body category diagnostic, including in either error form. This includes both `EK0104` and `EK0105` for `async effect get x() { }`. Otherwise a member gets one diagnostic: the first row that names it. The last row applies only when no other row applies. For example, `_tag = 1` reports `EK2117`; `static x = 1` reports the static-member rule, not the general member rule.", Host: "none", Decls: "⟦export schema error Bad { static x = 1 }⟧", Code: 1302, OneDiagnostic: true})
	add(&failCase{Name: "schema-error-implements", Quote: "| any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element, in either error form (for example `id = 1`, `private id: string`, `#id = 1`, `declare id: string`, `accessor id = 1`, or an index signature); an `implements` clause | `EK1304` |", Host: "none", Decls: "interface Shape {}\n⟦export schema error Bad implements Shape {}⟧", Code: 1304})
	add(&failCase{Name: "schema-error-default-export", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).", Host: "none", Decls: "⟦export default schema error Bad⟧", Code: 1305, Owner: "fix-vip-decls"})
	add(&failCase{Name: "error-context-newline", Quote: "`error`, like `service`, `schema` and `data`, follows TypeScript's contextual keyword `type`: a declaration is the keyword, no line break, then the declaration's name (a `BindingIdentifier`), where a declaration can start; anything else is ordinary TypeScript, where `error` is an identifier ([Declaration keywords](900-appendices.md#declaration-keywords), the one rule for all four). So `const error = …`, `catch (error)`, `const e = error as Error` and `error instanceof NotFound` still work, and `error as T;` declares `as`, then fails; write `(error as T);`. The body is optional, as for TypeScript's `declare module \"m\"` ([ErrorDeclaration](900-appendices.md#errordeclaration)). As in ECMAScript's `ExportDeclaration`, `export error E` and `export schema error E` are named declarations; `export default error E` and `export default schema error E` are syntax errors (`EK1305`). Write `export { E as default }` instead, as for a [service](005-services.md).", Host: "none", Decls: "const error = 1\nconst Missing = 2\nerror\nMissing\nexport const n = error + Missing"})
	add(&failCase{Name: "interface-local-member", Quote: "2. **Own thrown type:** a written `@throws {T}` on the declaration or its declared call signature gives `T` (a checked upper bound in `.vibe`). Otherwise use the shipped annotation, installed on the signature before defaults apply ([Appendix E](900-appendices.md#appendix-e-shipped-throws-and-rethrows-annotations)). Otherwise infer a plain `.vibe` function's uncaught throws and unwrapped throwing calls, including instance field initializers and an implicit `super(...args)` for a derived class with no written constructor. An uncaught `throw e` contributes the TypeScript type of `e`: a catch-clause binding contributes `unknown` under `useUnknownInCatchVariables`. Otherwise a callable declared in `.ts`, `.d.ts` or JavaScript has `unknown`, whether its type is written or inferred: functions, callable constants, class or interface methods, function-typed property signatures or fields, and each overload. A function type in a `.vibe` type position (parameter, alias, interface member or annotation) instead defaults to `never`.", Body: "reader.read()", Decls: "interface Reader { read(): string }\ndeclare const reader: Reader"})
	add(&failCase{Name: "effect-decoder-sync-build", Quote: "| `Schema.decodeUnknownSync(Schema.String)` or `Schema.decodeSync(Schema.String)` | `never` | call directly to build the decoder |", Body: "const decode = Schema.decodeSync(Schema.String)"})
	add(&failCase{Name: "effect-decoder-sync-call", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeSync(Schema.String)\n⟦decode(s)⟧"})
	add(&failCase{Name: "effect-decoder-sync-wrapped", Quote: "| `decode(value)` for that decoder | `SchemaError` | `try Effect.try(() => decode(value))` |", Body: "const decode = Schema.decodeSync(Schema.String)\nreturn try Effect.try(() => decode(s))"})
	return append(cases, failuresExtraCases()...)
}

// failuresNotAsserted are the chapter's bullets and rows no case checks,
// each with the reason. Each key must be verbatim in the chapter.
var failuresNotAsserted = map[string]string{
	"| `throw e` means |": "table header",
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
		// Chapter 1: a callable const places its contract on its own
		// call signature, in a type literal, not on the const binding.
		if strings.Contains(m[0], "const ") {
			call := regexp.MustCompile(`(?s)\bconst ` + name + `\s*:\s*\{\s*/\*\*((?:[^*]|\*[^/])*)\*/\s*\(`).FindStringSubmatch(text)
			if call == nil {
				problems = append(problems, fmt.Sprintf("%s needs a tagged call signature in a type literal", name))
				continue
			}
			comment = call[1]
		}
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
