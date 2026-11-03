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
	"A `throw` statement is `EK0401`, whether or not a `try` statement in the same function catches it.",
	"*known to throw* is `EK0401`, unless it sits in the `try` block of a `try` statement that has a `catch` clause, in the same function",
	"A call in the `catch` or `finally` block, or in a `try` statement with only `finally`, is the error.",
	"A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call.",
	"| an `async` function, arrow or method, or an async generator | JavaScript's `throw`: the returned Promise rejects with `e` (decided detail 251) |",
	"plain function declarations, function expressions and arrows (one nested in effect code included), plain methods, constructors, getters and setters, plain generators",
	"Its callee has a written or shipped `@throws {T}` other than `@throws {never}` (`@throws {unknown}` included)",
}

func nothrowPlacementChapter(tb testing.TB) {
	chapter := SpecText("003-failures.md")
	for _, quote := range nothrowPlacementQuotes {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("chapter 3 no longer says %q", quote)
		}
	}
}

func TestNothrowPlacementQuoted(t *testing.T) { nothrowPlacementChapter(t) }

// nothrowKind is a kind of code that holds the payload. wrap writes a module
// around body; effect marks effect code and async an async function, where
// no payload is EK0401.
type nothrowKind struct {
	key           string
	effect, async bool
	wrap          func(body string) string
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
// contract (decided detail 255). quote is the chapter quote each one checks.
var nothrowPayloads = []struct {
	key, text string
	quote     int
}{
	{"throw", "throw new Bad()", 0},
	{"known-call", "JSON.parse(\"1\")", 1},
	{"unknown-call", "legacy(\"1\")", 3},
	{"unknown-contract-call", "risky(\"1\")", 6},
}

const nothrowLegacy = "export function legacy(text: string): string {\n  if (!text) throw new Error(\"empty\")\n  return text\n}\n" +
	"/** @throws {unknown} */\nexport function risky(text: string): string {\n  if (!text) throw new Error(\"empty\")\n  return text\n}\n"

// nothrowShape reads a keyed input ("arrow/try/known-call") or, for other
// bytes, picks the kind, position and payload by byte.
func nothrowShape(data []byte) (kind nothrowKind, position nothrowPosition, payload int) {
	parts := strings.Split(string(data), "/")
	if len(parts) == 3 {
		k := slices.IndexFunc(nothrowKinds, func(k nothrowKind) bool { return k.key == parts[0] })
		p := slices.IndexFunc(nothrowPositions, func(p nothrowPosition) bool { return p.key == parts[1] })
		l := slices.IndexFunc(nothrowPayloads, func(l struct {
			key, text string
			quote     int
		}) bool {
			return l.key == parts[2]
		})
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
	for _, seed := range []string{"declaration/try/unknown-contract-call", "declaration/catch/unknown-contract-call", "constructor/try/known-call", "plain-handler/catch/known-call", "nested-plain/try-nested-arrow/known-call", "effect/nested-arrow/throw", "async/nested-arrow/known-call", "top-level/try/throw", "generator/finally/known-call", "getter/try-finally/known-call"} {
		f.Add([]byte(seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		kind, position, payload := nothrowShape(data)
		if kind.effect && position.try {
			// A try statement in effect code is EK0503, outside this rule.
			position = nothrowPositions[0]
		}
		shape := kind.key + "/" + position.key + "/" + nothrowPayloads[payload].key
		body := position.open + nothrowPayloads[payload].text + position.close
		source := "import { legacy, risky } from \"./legacy.ts\"\nerror Bad\n" + kind.wrap(body)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "legacy.ts": nothrowLegacy}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		call := nothrowPayloads[payload].key != "throw"
		// effect code checks an unwrapped call itself (EK0403, EK4401), and an
		// async function's calls are its own; neither is this rule
		others := call && (kind.effect || kind.async) && !position.nested
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
		plain := position.nested || !kind.effect && !kind.async
		want := 0
		switch nothrowPayloads[payload].key {
		case "throw":
			if plain {
				want = 1 // quote 0, and quote 4 for async
			}
		case "known-call", "unknown-contract-call":
			if plain && !position.caught {
				want = 1 // quotes 1 and 2
			}
		}
		if reported != want {
			Gap(t, "FuzzNothrowPlacement", fmt.Sprintf("EK0401:%d:%s", want, shape), "chapter 3: %q; want %d EK0401, got %d for %s:\n%s", nothrowPlacementQuotes[nothrowPayloads[payload].quote], want, reported, shape, source)
			return
		}
		ExpectPending(t, "FuzzNothrowPlacement", fmt.Sprintf("EK0401:%d:%s", want, shape))
	})
}
