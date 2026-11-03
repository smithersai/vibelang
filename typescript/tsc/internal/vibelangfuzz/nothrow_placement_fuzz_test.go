package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3, "Plain code never throws" (VIP-4, amended 2026-10-31): a `throw`
// statement, or a call known to throw, in synchronous VibeLang code outside
// effect code is `EK0401`. The quotes are read from the chapter at test time.
// The generator places one payload, a `throw`, a call known to throw
// (`JSON.parse`, or a `.ts` function tagged `@throws {unknown}`) or a `.ts`
// call whose throwing is unknown (no tag), in every kind of function and in
// every position around a `try` statement. The oracle is the chapter's rule:
// exactly one `EK0401` when the payload is a throw or a known call in plain
// code, except a known call in the `try` block of a `try` with a `catch` in the
// same function; none in effect code, in an `async` function, and none for
// the unknown call. Effect code's own checks of an unwrapped call (`EK0403`,
// `EK4401`) are outside this rule.
var nothrowPlacementQuotes = []string{
	"A `throw` statement is `EK0401`, even when a `try` statement in the same function catches it.",
	"*known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement with a `catch` clause in the same function.",
	"function orNull(s: string) { try { return JSON.parse(s) } catch { return null } } // allowed",
	"A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call",
	"| an `async` function, arrow or method, its parameter list included, an `async` generator's body, or an `async match` | JavaScript's `throw`: the returned Promise rejects with `e` |",
	"plain functions and arrows (one nested in effect code included), plain methods, constructors, accessors, plain generators",
	"Its callee has a written `@throws {T}` other than `@throws {never}` (`@throws {unknown}` included)",
	"may contain calls known to throw: they belong to the enclosing call.",
	"(for a rest parameter, the element type or tuple member at the argument's position)",
	"every parameter list except an ordinary `async` function's",
	"A `do` expression is not a function, so a call in a `do` block inside that `try` block, or a `try` statement inside a `do` block, follows the same rule.",
}

// nothrowPlacementFolded marks the quotes that fold-details folds from
// nothrow-impl.patch; each is checked once that text lands.
var nothrowPlacementFolded = map[int]bool{8: true, 10: true}

func nothrowPlacementChapter(tb testing.TB) {
	chapter := SpecText("003-failures.md")
	for i, quote := range nothrowPlacementQuotes {
		if nothrowPlacementFolded[i] && nothrowFoldPending() {
			continue
		}
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("chapter 3 no longer says %q", quote)
		}
	}
}

func TestNothrowPlacementQuoted(t *testing.T) { nothrowPlacementChapter(t) }

// nothrowKind is a kind of code that holds the payload. wrap writes a module
// around body; effect marks effect code and async an async function, where
// no payload is EK0401. A kind with a default writes the payload as an
// expression into a parameter's default, in the direct position only; plain
// marks a parameter list that is synchronous code (quote 9). admitted marks a
// function literal passed where its parameter admits throws (quotes 7 and 8):
// a rest parameter's element or a tuple-rest member at the argument's
// position (PREVIEW-10), where a known call belongs to the receiving call.
type nothrowKind struct {
	key           string
	effect, async bool
	admitted      bool
	wrap          func(body string) string
	def           func(expr string) string
	plain         bool
}

var nothrowKinds = []nothrowKind{
	{key: "declaration", wrap: func(b string) string { return "export function f(x: number): number {\n  " + b + "\n  return x\n}\n" }},
	{key: "expression", wrap: func(b string) string {
		return "export const f = function (x: number): number {\n  " + b + "\n  return x\n}\n"
	}},
	{key: "arrow", wrap: func(b string) string {
		return "export const f = (x: number): number => {\n  " + b + "\n  return x\n}\n"
	}},
	{key: "method", wrap: func(b string) string {
		return "export class C {\n  m(x: number): number {\n    " + b + "\n    return x\n  }\n}\n"
	}},
	{key: "static-method", wrap: func(b string) string {
		return "export class C {\n  static m(x: number): number {\n    " + b + "\n    return x\n  }\n}\n"
	}},
	{key: "object-method", wrap: func(b string) string {
		return "export const o = {\n  m(x: number): number {\n    " + b + "\n    return x\n  },\n}\n"
	}},
	{key: "constructor", wrap: func(b string) string {
		return "export class C {\n  constructor(readonly x: number) {\n    " + b + "\n  }\n}\n"
	}},
	{key: "getter", wrap: func(b string) string {
		return "export class C {\n  get v(): number {\n    " + b + "\n    return 1\n  }\n}\n"
	}},
	{key: "setter", wrap: func(b string) string { return "export class C {\n  set v(x: number) {\n    " + b + "\n  }\n}\n" }},
	{key: "static-block", wrap: func(b string) string { return "export class C {\n  static {\n    " + b + "\n  }\n}\n" }},
	{key: "generator", wrap: func(b string) string { return "export function* g(): Generator<number> {\n  " + b + "\n  yield 1\n}\n" }},
	{key: "top-level", wrap: func(b string) string { return b + "\n" }},
	{key: "plain-handler", wrap: func(b string) string {
		return "effect function load(): number!string { return 1 }\nexport effect function f() {\n  return try (load() catch (e) => {\n    " + b + "\n    return 1\n  })\n}\n"
	}},
	{key: "nested-plain", wrap: func(b string) string {
		return "export effect function f() {\n  const g = (x: number): number => {\n    " + b + "\n    return x\n  }\n  return g(1)\n}\n"
	}},
	{key: "effect", effect: true, wrap: func(b string) string { return "export effect function f(x: number) {\n  " + b + "\n  return x\n}\n" }},
	{key: "effect-arrow", effect: true, wrap: func(b string) string { return "export const f = effect (x: number) => {\n  " + b + "\n  return x\n}\n" }},
	{key: "effect-method", effect: true, wrap: func(b string) string {
		return "export class C {\n  effect m(x: number) {\n    " + b + "\n    return x\n  }\n}\n"
	}},
	{key: "async", async: true, wrap: func(b string) string { return "export async function f(x: number) {\n  " + b + "\n  return x\n}\n" }},
	{key: "async-arrow", async: true, wrap: func(b string) string { return "export const f = async (x: number) => {\n  " + b + "\n  return x\n}\n" }},
	{key: "rest-first", admitted: true, wrap: nothrowCallback("rest(", ")")},
	{key: "rest-later", admitted: true, wrap: nothrowCallback("rest(() => 0, ", ")")},
	{key: "rest-after-fixed", admitted: true, wrap: nothrowCallback("afterFixed(\"a\", ", ")")},
	{key: "tuple-reader", admitted: true, wrap: nothrowCallback("pair(", ", () => 0)")},
	{key: "tuple-plain", wrap: nothrowCallback("pair(() => 0, ", ")")},
	{key: "fixed-reader", admitted: true, wrap: nothrowCallback("fixed(", ")")},
	{key: "fixed-plain", wrap: nothrowCallback("fixedPlain(", ")")},
	{key: "declaration-default", plain: true, def: func(e string) string { return "export function f(x: unknown = " + e + "): unknown {\n  return x\n}\n" }},
	{key: "effect-default", effect: true, plain: true, def: func(e string) string { return "export effect function f(x: unknown = " + e + ") {\n  return x\n}\n" }},
	{key: "async-default", async: true, def: func(e string) string { return "export async function f(x: unknown = " + e + ") {\n  return x\n}\n" }},
	{key: "async-arrow-default", async: true, def: func(e string) string { return "export const f = async (x: unknown = " + e + ") => x\n" }},
	{key: "async-generator-default", async: true, plain: true, def: func(e string) string {
		return "export async function* g(x: unknown = " + e + ") {\n  yield x\n}\n"
	}},
}

// nothrowCallback writes body into an arrow passed to a .ts receiver between
// open and close.
func nothrowCallback(open, close string) func(string) string {
	return func(b string) string {
		return "export function f(): unknown {\n  return " + open + "(): unknown => {\n    " + b + "\n    return 1\n  }" + close + "\n}\n"
	}
}

// nothrowPosition places a statement. caught marks the try block of a try
// statement with a catch clause, which a known call can't leave; try marks a
// try statement, which effect code doesn't have (EK0503); nested moves the
// payload into a plain arrow of its own.
type nothrowPosition struct {
	key, open, close    string
	caught, try, nested bool
}

var nothrowPositions = []nothrowPosition{
	{key: "direct"},
	{key: "if", open: "if (Math.random() > 2) { ", close: " }"},
	{key: "loop", open: "for (const c of [1]) { ", close: " }"},
	{key: "try", open: "try { ", close: " } catch { }", caught: true, try: true},
	{key: "catch", open: "try { } catch { ", close: " }", try: true},
	{key: "finally", open: "try { } catch { } finally { ", close: " }", try: true},
	{key: "try-finally", open: "try { ", close: " } finally { }", try: true},
	{key: "nested-arrow", open: "const h = (): void => { ", close: " }; h()", nested: true},
	{key: "try-nested-arrow", open: "try { const h = (): void => { ", close: " }; h() } catch { }", try: true, nested: true},
}

// nothrowPayloads: a throw, a call known to throw (a built-in's shipped
// contract), a call whose throwing is unknown (a .ts function with no tag),
// and a call to a .ts function tagged @throws {unknown}, an affirmative
// contract (decided detail 255). quote is the chapter quote each one checks;
// expr is the payload as a parameter default.
type nothrowPayload struct {
	key, text, expr string
	quote           int
}

var nothrowPayloads = []nothrowPayload{
	{"throw", "throw new Bad()", "maybe ?? throw new Bad()", 0},
	{"known-call", "JSON.parse(\"1\")", "JSON.parse(\"1\")", 1},
	{"unknown-call", "legacy(\"1\")", "legacy(\"1\")", 3},
	{"unknown-contract-call", "risky(\"1\")", "risky(\"1\")", 6},
}

const nothrowLegacy = "export function legacy(text: string): string {\n  if (!text) throw new Error(\"empty\")\n  return text\n}\n" +
	"/** @throws {unknown} */\nexport function risky(text: string): string {\n  if (!text) throw new Error(\"empty\")\n  return text\n}\n" +
	"export type Reader = {\n  /** @throws {unknown} */\n  (): unknown\n}\nexport type Plain = () => unknown\n" +
	"/** @throws {never} */\nexport function rest(...fs: Reader[]): unknown {\n  try { return fs.map((g) => g()) } catch { return 0 }\n}\n" +
	"/** @throws {never} */\nexport function afterFixed(label: string, ...fs: Reader[]): unknown {\n  try { return [label, fs.map((g) => g())] } catch { return 0 }\n}\n" +
	"/** @throws {never} */\nexport function pair(...fs: [Reader, Plain]): unknown {\n  try { return fs.map((g) => g()) } catch { return 0 }\n}\n" +
	"/** @throws {never} */\nexport function fixed(g: Reader): unknown {\n  try { return g() } catch { return 0 }\n}\n" +
	"/** @throws {never} */\nexport function fixedPlain(g: Plain): unknown {\n  try { return g() } catch { return 0 }\n}\n"

// nothrowShape reads a keyed input ("arrow/try/known-call") or, for other
// bytes, picks the kind, position and payload by byte.
func nothrowShape(data []byte) (kind nothrowKind, position nothrowPosition, payload int) {
	parts := strings.Split(string(data), "/")
	if len(parts) == 3 {
		k := slices.IndexFunc(nothrowKinds, func(k nothrowKind) bool { return k.key == parts[0] })
		p := slices.IndexFunc(nothrowPositions, func(p nothrowPosition) bool { return p.key == parts[1] })
		l := slices.IndexFunc(nothrowPayloads, func(l nothrowPayload) bool { return l.key == parts[2] })
		if k >= 0 && p >= 0 && l >= 0 {
			return nothrowKinds[k], nothrowPositions[p], l
		}
	}
	for len(data) < 3 {
		data = append(data, 0)
	}
	return nothrowKinds[int(data[0])%len(nothrowKinds)], nothrowPositions[int(data[1])%len(nothrowPositions)], int(data[2]) % len(nothrowPayloads)
}

func FuzzNothrowPlacement(f *testing.F) {
	startShortBudget(f)
	nothrowPlacementChapter(f)
	for _, k := range nothrowKinds {
		for _, l := range nothrowPayloads {
			f.Add([]byte(k.key + "/direct/" + l.key))
		}
	}
	for _, p := range nothrowPositions {
		for _, l := range nothrowPayloads[:2] {
			f.Add([]byte("declaration/" + p.key + "/" + l.key))
		}
	}
	for _, seed := range []string{"rest-later/if/known-call", "tuple-plain/loop/known-call", "rest-after-fixed/nested-arrow/known-call", "rest-first/catch/unknown-contract-call", "declaration/try/unknown-contract-call", "declaration/catch/unknown-contract-call", "constructor/try/known-call", "plain-handler/catch/known-call", "nested-plain/try-nested-arrow/known-call", "effect/nested-arrow/throw", "async/nested-arrow/known-call", "top-level/try/throw", "generator/finally/known-call", "getter/try-finally/known-call"} {
		f.Add([]byte(seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		kind, position, payload := nothrowShape(data)
		if kind.effect && position.try || kind.def != nil {
			// A try statement in effect code is EK0503, outside this rule;
			// a default holds an expression, so it has no position.
			position = nothrowPositions[0]
		}
		shape := kind.key + "/" + position.key + "/" + nothrowPayloads[payload].key
		var code string
		if kind.def != nil {
			code = kind.def(nothrowPayloads[payload].expr)
		} else {
			code = kind.wrap(position.open + nothrowPayloads[payload].text + position.close)
		}
		source := "import { legacy, risky, rest, afterFixed, pair, fixed, fixedPlain } from \"./legacy.ts\"\nerror Bad\ndeclare const maybe: unknown\n" + code
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "legacy.ts": nothrowLegacy}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		call := nothrowPayloads[payload].key != "throw"
		// effect code and the code a fiber runs, a plain handler's body and an
		// effect function's defaults, check an unwrapped call themselves
		// (EK0403, EK4401), and an async function's calls are its own; none is
		// this rule, which only counts EK0401
		others := call && (kind.effect || kind.async || kind.key == "plain-handler") && !position.nested
		reported := 0
		var errs []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 401 {
				reported++
				continue
			}
			errs = append(errs, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
		if len(errs) > 0 && !others {
			Gap(t, "FuzzNothrowPlacement", "compile:"+shape, "%s should have no error but EK0401:\n%s\n%s", shape, source, strings.Join(errs, "\n"))
			return
		}
		plain := position.nested || !kind.effect && !kind.async || kind.def != nil && kind.plain
		want := 0
		switch nothrowPayloads[payload].key {
		case "throw":
			if plain {
				want = 1 // quote 0, and quote 4 for async
			}
		case "known-call", "unknown-contract-call":
			if plain && !position.caught && !(kind.admitted && !position.nested) {
				want = 1 // quotes 1 and 2; an admitted callback's own body, quotes 7 and 8
			}
		}
		if reported != want {
			Gap(t, "FuzzNothrowPlacement", fmt.Sprintf("EK0401:%d:%s", want, shape), "chapter 3: %q; want %d EK0401, got %d for %s:\n%s", nothrowPlacementQuotes[nothrowPayloads[payload].quote], want, reported, shape, source)
			return
		}
		ExpectPending(t, "FuzzNothrowPlacement", fmt.Sprintf("EK0401:%d:%s", want, shape))
	})
}
