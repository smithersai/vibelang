package compiler

import "testing"

// ---------------------------------------------------------------------------
// Dynamic code evaluation — SMITHERS1604
// ---------------------------------------------------------------------------

// TestPinnedForkDynamicCodeEvaluationIsRefused pins the rule that closes the
// one hole in the host-global allowlist.
//
// `eval` and `Function` used to sit in `universalGlobals` because ECMA-262
// clause 19 publishes them, and the same table's own comment gives the reason
// `globalThis` is excluded — "the one language global whose purpose is to hand
// back the host's namespace". That sentence is true of these two verbatim.
// Measured on this backend before the rule existed, with a runtime oracle: 19
// spellings compiled with `failures: [] requirements: []`, zero diagnostics, and
// RAN — `eval("process.platform")` printed the host platform where the direct
// spelling is SMITHERS1601, `eval("Date.now()")` printed a wall clock where the
// direct spelling is SMITHERS1602, and `eval("Math.random()")` bypassed
// SMITHERS1603 entirely.
//
// The rule refuses the OPERATION and leaves the NAME resolvable, which is the
// shape `crypto` already has. The acceptance rows below are therefore not
// decoration: without them the rule can be widened to "any mention of
// `Function`" and nothing notices.
func TestPinnedForkDynamicCodeEvaluationIsRefused(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "eval reaches the host namespace",
			//                123456789012345678901234
			source: "export function main(): string[] {\n" +
				"  return [String(eval(\"process.platform\"))]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:18"},
		},
		{
			name: "eval bypasses the clock and randomness capabilities",
			source: "export function main(): string[] {\n" +
				"  const stamp = String(eval(\"Date.now()\"))\n" +
				"  const roll = String(eval(\"Math.random()\"))\n" +
				"  return [stamp, roll]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:24", "SMITHERS1604@3:23"},
		},
		{
			name: "an alias of eval is the same read",
			source: "export function main(): string[] {\n" +
				"  const e: any = eval\n" +
				"  return [String(e(\"process.platform\"))]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:18"},
		},
		{
			name: "the indirect comma spelling is the same read",
			source: "export function main(): string[] {\n" +
				"  return [String((0, eval)(\"process.platform\"))]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:22"},
		},
		{
			name: "an ES2015 shorthand property is the same read",
			source: "export function main(): string[] {\n" +
				"  const bag = { eval }\n" +
				"  return [String((bag.eval as (s: string) => unknown)(\"process.platform\"))]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:17"},
		},
		{
			name: "the Function constructor is dynamic code evaluation",
			source: "export function main(): string[] {\n" +
				"  return [String(new Function(\"return process.platform\")())]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:22"},
		},
		{
			name: "Reflect.construct and Reflect.apply reach it through a read",
			source: "export function main(): string[] {\n" +
				"  const a = (Reflect.construct(Function, [\"return 1\"]) as () => number)()\n" +
				"  const b = (Reflect.apply(Function, undefined, [\"return 2\"]) as () => number)()\n" +
				"  return [String(a), String(b)]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:32", "SMITHERS1604@3:28"},
		},
		{
			name: "Function.prototype.constructor is the same object",
			source: "export function main(): string[] {\n" +
				"  const F: any = Function.prototype.constructor\n" +
				"  return [String(new F(\"return process.platform\")())]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:18"},
		},
		{
			name: "a callable's constructor is the Function constructor",
			source: "export function main(): string[] {\n" +
				"  const F: any = (function () {}).constructor\n" +
				"  return [String(new F(\"return process.platform\")())]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:35"},
		},
		{
			name: "an aliased constructor key is the same selection",
			source: "const KEY = \"constructor\"\n" +
				"export function main(): string[] {\n" +
				"  const f = function () {}\n" +
				"  return [String(typeof f[KEY])]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@4:27"},
		},
		{
			name: "typeof eval still reads the binding",
			source: "export function main(): string[] {\n" +
				"  return [String(typeof eval)]\n" +
				"}\n",
			reject: []string{"SMITHERS1604@2:25"},
		},
		// --- the acceptance half: the NAME stays resolvable ---
		{
			name: "instanceof Function is a prototype test",
			source: "export function main(): string[] {\n" +
				"  const f = function () {}\n" +
				"  return [String(f instanceof Function)]\n" +
				"}\n",
			stdout: "true",
		},
		{
			name: "Function stays a usable type annotation",
			source: "function take(callback: Function): string {\n" +
				"  return typeof callback\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [take(function () {})]\n" +
				"}\n",
			stdout: "function",
		},
		{
			name: "a local binding named eval is an ordinary value",
			source: "export function main(): string[] {\n" +
				"  const eval2 = (text: string): string => \"local:\" + text\n" +
				"  return [eval2(\"OK\")]\n" +
				"}\n",
			stdout: "local:OK",
		},
		{
			name: "an ordinary constructor read is not the Function constructor",
			source: "class C {}\n" +
				"export function main(): string[] {\n" +
				"  return [String(typeof ({}).constructor), String(typeof [].constructor),\n" +
				"    String(new C().constructor.name), String(typeof \"s\".constructor)]\n" +
				"}\n",
			stdout: "function\nfunction\nC\nfunction",
		},
		{
			name: "the rest of the ECMAScript global object stays available",
			source: "export function main(): string[] {\n" +
				"  return [String(parseInt(\"41\", 10)), JSON.stringify({ a: 1 })]\n" +
				"}\n",
			stdout: "41\n{\"a\":1}",
		},
	})
}

// ---------------------------------------------------------------------------
// Member key spellings — the checker's answer, not the key's spelling
// ---------------------------------------------------------------------------

// TestPinnedForkMemberKeySpellingsSelectTheSameMember pins both directions of
// the `selectMember` criterion.
//
// The walk used to apply `ast.SkipParentheses` to the key and then require
// `ast.IsStringLiteralLike`, so it saw `Clock[("context")]` and missed
// `Clock[KEY]`, `Clock["context" satisfies string]`, `Clock[("context") as
// const]`, `Clock[<"context">"context"]`, and an alias of an alias. Measured on
// this backend: each of those five compiled `ok: true` with an EMPTY capability
// row and PANICKED at run time with `capability 'Clock' was not provided` — the
// exact program 05-context-rows/a-computed-context-access-charges-the-same-row
// certifies as SMITHERS2102.
//
// The over-refusal half is the ambient per-member walk, which shared the same
// blindness in the other direction: an unresolved key fell to the whole-root arm
// and charged everything, so `Date[PARSE]` and `Math[MAX]` — pure functions of
// their arguments, needing no capability — were refused. The reference runs both
// and prints `1577836800000` and `2`.
func TestPinnedForkMemberKeySpellingsSelectTheSameMember(t *testing.T) {
	const capability = "import { Context } from \"smthrs/context\"\n" +
		"\n" +
		"abstract class Clock extends Context {\n" +
		"  abstract now(): number\n" +
		"}\n" +
		"\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a const-alias key charges the same row",
			source: capability +
				"const KEY = \"context\"\n" +
				"\n" +
				"function timestamp(): number {\n" +
				"  return Clock[KEY]().now()\n" +
				"}\n" +
				"\n" +
				"export const stamped = [`${timestamp()}`]\n",
			reject: []string{"SMITHERS2102@13:28"},
		},
		{
			name: "an alias of an alias charges the same row",
			source: capability +
				"const KEY = \"context\"\n" +
				"const KEY2 = KEY\n" +
				"\n" +
				"function timestamp(): number {\n" +
				"  return Clock[KEY2]().now()\n" +
				"}\n" +
				"\n" +
				"export const stamped = [`${timestamp()}`]\n",
			reject: []string{"SMITHERS2102@14:28"},
		},
		{
			name: "a satisfies-wrapped key charges the same row",
			source: capability +
				"function timestamp(): number {\n" +
				"  return Clock[\"context\" satisfies string]().now()\n" +
				"}\n" +
				"\n" +
				"export const stamped = [`${timestamp()}`]\n",
			reject: []string{"SMITHERS2102@11:28"},
		},
		{
			name: "an as-const key charges the same row",
			source: capability +
				"function timestamp(): number {\n" +
				"  return Clock[(\"context\") as const]().now()\n" +
				"}\n" +
				"\n" +
				"export const stamped = [`${timestamp()}`]\n",
			reject: []string{"SMITHERS2102@11:28"},
		},
		{
			name: "a type-assertion key charges the same row",
			source: capability +
				"function timestamp(): number {\n" +
				"  return Clock[<\"context\">\"context\"]().now()\n" +
				"}\n" +
				"\n" +
				"export const stamped = [`${timestamp()}`]\n",
			reject: []string{"SMITHERS2102@11:28"},
		},
		{
			name: "an aliased clock member key is the same clock read",
			source: "const NOW = \"now\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [String(Date[NOW]())]\n" +
				"}\n",
			reject: []string{"SMITHERS1602@4:18"},
		},
		{
			name: "an aliased Reflect.panic key is still the panic intrinsic",
			source: "const KEY = \"panic\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const v = 1 > 2 ? Reflect[KEY](\"no\") : \"ok\"\n" +
				"  return [v]\n" +
				"}\n",
			reject: []string{"SMITHERS1503@4:21"},
		},
		// --- the over-refusal half: a pure member needs no capability ---
		{
			name: "an aliased pure member key needs no capability",
			source: "const PARSE = \"parse\"\n" +
				"const MAX = \"max\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${Date[PARSE](\"2020-01-01T00:00:00.000Z\")}`, `${Math[MAX](2, 7, 5)}`]\n" +
				"}\n",
			stdout: "1577836800000\n7",
		},
		{
			name: "a destructured pure member key needs no capability",
			source: "const PARSE = \"parse\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const { [PARSE]: parse } = Date\n" +
				"  return [`${parse(\"2020-01-01T00:00:00.000Z\")}`]\n" +
				"}\n",
			stdout: "1577836800000",
		},
		{
			name: "a widening string key names no member, so the whole object escapes",
			// `"now" as string` widens the literal away, so no property symbol
			// resolves and the use is judged on the object — the same fail-closed
			// answer the reference gives, at the same position.
			source: "export function main(): string[] {\n" +
				"  return [`${Date[\"now\" as string]()}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1602@2:14"},
		},
		{
			name: "a user object with a same-spelled member is not claimed",
			source: "const KEY = \"context\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const own = { context: () => 7 }\n" +
				"  return [`${own[KEY]()}`]\n" +
				"}\n",
			stdout: "7",
		},
	})
}

// ---------------------------------------------------------------------------
// The parent/operand wrapper walks — SMITHERS1104 / SMITHERS1207 / SMITHERS1302
// ---------------------------------------------------------------------------

const wrapperPrelude = "export class Boom extends Error {\n" +
	"  constructor(readonly info: string) { super(\"boom \" + info) }\n" +
	"}\n" +
	"export class Calm extends Error {\n" +
	"  constructor(readonly info: string) { super(\"calm \" + info) }\n" +
	"}\n" +
	"\n" +
	"function inferred(key: string) {\n" +
	"  if (key !== \"ok\") throw new Boom(key)\n" +
	"  return 1\n" +
	"}\n" +
	"\n"

// TestPinnedForkStoredResultPropagationMatchesReference pins the binding edge in
// both directions at once.
//
// `resultPropagationOperand` restated the wrapper table by hand — `Paren, As,
// TypeAssertion, Await`, no `satisfies` — 1,400 lines below
// `typeOnlyWrapperOperand` ("THE ONE TABLE"), and it had no identifier case at
// all, so a Result reached through a `const` binding was invisible unless the
// binding's authored TypeScript type was ALREADY the prelude Result. That is
// true for an annotated callee and false for an inferred-fallible one, which is
// why every existing `satisfies` corpus case sailed past: the annotated type
// masked the missing entries.
//
// Measured: `const r = inferred("ok"); const v = r!` — the most ordinary
// store-then-propagate spelling in the language — did not compile on this
// backend while the reference ran both its paths, and it was refused by TWO
// diagnostics that contradict each other about the same value, SMITHERS1302
// ("Result 'r' is never consumed", from the must-consume walk, which saw a
// Result through the binding) and SMITHERS1207 ("postfix ! requires a Result
// operand", from the propagation walk, which did not).
//
// The row half is why the acceptance rows and the SMITHERS1104 rows have to be
// pinned together: recognizing `r!` as a propagation without also charging its
// row would turn a refusal into a FAIL-OPEN, letting
// `outer(): Result<number, Calm>` compile over a body that can only produce
// `Boom`.
func TestPinnedForkStoredResultPropagationMatchesReference(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a stored inferred-fallible Result propagates",
			source: wrapperPrelude +
				"export function outer(): Result<number, Boom> {\n" +
				"  const r = inferred(\"ok\")\n" +
				"  const v = r!\n" +
				"  return v + 1\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer().match({ ok: (n) => \"ok \" + n, error: (e) => \"err \" + e.message })]\n" +
				"}\n",
			stdout: "ok 2",
		},
		{
			name: "the failing path of the same program",
			source: wrapperPrelude +
				"export function outer(): Result<number, Boom> {\n" +
				"  const r = inferred(\"bad\")\n" +
				"  const v = r!\n" +
				"  return v + 1\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer().match({ ok: (n) => \"ok \" + n, error: (e) => \"err \" + e.message })]\n" +
				"}\n",
			stdout: "err boom bad",
		},
		{
			name: "a satisfies-wrapped propagation is the same propagation",
			source: wrapperPrelude +
				"export function outer(): Result<number, Boom> {\n" +
				"  const v = (inferred(\"ok\") satisfies unknown)!\n" +
				"  return v + 1\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer().match({ ok: (n) => \"ok \" + n, error: (e) => \"err \" + e.message })]\n" +
				"}\n",
			stdout: "ok 2",
		},
		{
			name: "a satisfies-wrapped store then propagate",
			source: wrapperPrelude +
				"export function outer(): Result<number, Boom> {\n" +
				"  const r = inferred(\"ok\") satisfies unknown\n" +
				"  const v = r!\n" +
				"  return v + 1\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer().match({ ok: (n) => \"ok \" + n, error: (e) => \"err \" + e.message })]\n" +
				"}\n",
			stdout: "ok 2",
		},
		// --- the row half: the same spellings must still charge the contract ---
		{
			name: "a stored propagation still charges the contract",
			source: wrapperPrelude +
				"export function outer(): Result<number, Calm> {\n" +
				"  const r = inferred(\"bad\")\n" +
				"  const v = r!\n" +
				"  return v + 1\n" +
				"}\n",
			reject: []string{"SMITHERS1104@13:1"},
		},
		{
			name: "a satisfies-wrapped propagation still charges the contract",
			source: wrapperPrelude +
				"export function outer(): Result<number, Calm> {\n" +
				"  const v = (inferred(\"bad\") satisfies unknown)!\n" +
				"  return v + 1\n" +
				"}\n",
			reject: []string{"SMITHERS1104@13:1"},
		},
		{
			name: "a type-assertion-wrapped propagation still charges the contract",
			source: wrapperPrelude +
				"export function outer(): Result<number, Calm> {\n" +
				"  const v = (<number>inferred(\"bad\"))!\n" +
				"  return v + 1\n" +
				"}\n",
			reject: []string{"SMITHERS1104@13:1"},
		},
		{
			name: "a stored return still charges the contract",
			source: wrapperPrelude +
				"export function outer(): Result<number, Calm> {\n" +
				"  const r = inferred(\"bad\")\n" +
				"  return r\n" +
				"}\n",
			reject: []string{"SMITHERS1104@13:1"},
		},
		// --- the over-refusal half ---
		{
			name: "a binding holding an EXTRACTED value is not a Result",
			source: wrapperPrelude +
				"export function outer(): Result<number, Boom> {\n" +
				"  const r = inferred(\"ok\")!\n" +
				"  const v = r!\n" +
				"  return v + 1\n" +
				"}\n",
			reject: []string{"SMITHERS1207@15:13"},
		},
		{
			name: "a stored Result consumed by match is not propagated",
			source: wrapperPrelude +
				"export function outer(): Result<number, Calm> {\n" +
				"  const r = inferred(\"ok\")\n" +
				"  return r.match({ ok: (n) => n, error: () => 0 })\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer().match({ ok: (n) => \"ok \" + n, error: () => \"err\" })]\n" +
				"}\n",
			stdout: "ok 1",
		},
		{
			name: "an ordinary local value is never a Result",
			source: wrapperPrelude +
				"export function main(): string[] {\n" +
				"  const n = 41\n" +
				"  const v = n\n" +
				"  return [String(v + 1)]\n" +
				"}\n",
			stdout: "42",
		},
	})
}

// ---------------------------------------------------------------------------
// Module-initialization trust — the comment KIND is the scanner's answer
// ---------------------------------------------------------------------------

// TestPinnedForkTrustMarkerRequiresARealJSDoc pins the comment-kind half of
// SMITHERS1510.
//
// The marker was found by searching the raw leading text for a `/** … */`
// SUBSTRING, which asks no one whether a JSDoc exists at all. Measured with a
// runtime oracle: a `//` line comment whose body happens to contain the marker
// text, and a plain `/* … */` block containing it, both conferred
// module-initialization trust on this backend and the untrusted module's
// initializer RAN.
//
// The whitespace class is pinned here too, in the opposite direction: THIS
// backend's `[ \t\r\n]` was already the correct one and the reference moved to
// it, so the exotic spellings must stay refused while ordinary tabs and
// newlines keep working.
func TestPinnedForkTrustMarkerRequiresARealJSDoc(t *testing.T) {
	const importer = "import \"./foreign.ts\"\n" +
		"\n" +
		"export function main(): string[] {\n" +
		"  return [\"pure\"]\n" +
		"}\n"
	body := func(header string) string {
		return header + "\nexport const settings = { retries: 4 };\n"
	}
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a line comment holding the marker confers no trust",
			source:  importer,
			support: body("// /** @module @throws {never} */"),
			reject:  []string{"SMITHERS1510@1:8"},
		},
		{
			name:    "a plain block comment holding the marker confers no trust",
			source:  importer,
			support: body("/* /** @module @throws {never} */"),
			reject:  []string{"SMITHERS1510@1:8"},
		},
		{
			name:    "a single-asterisk block is not a JSDoc",
			source:  importer,
			support: body("/* @module @throws {never} */"),
			reject:  []string{"SMITHERS1510@1:8"},
		},
		{
			name:    "a non-breaking space inside the braces is not the marker",
			source:  importer,
			support: body("/** @module @throws { never } */"),
			reject:  []string{"SMITHERS1510@1:8"},
		},
		{
			name:   "a form feed inside the braces is not the marker",
			source: importer,
			support: body("/** @module @throws {never} */"),
			reject: []string{"SMITHERS1510@1:8"},
		},
		{
			name:    "an ideographic space inside the braces is not the marker",
			source:  importer,
			support: body("/** @module @throws {　never　} */"),
			reject:  []string{"SMITHERS1510@1:8"},
		},
		// --- the acceptance half ---
		{
			name:    "a real one-line JSDoc header confers trust",
			source:  importer,
			support: body("/** @module @throws {never} */"),
			stdout:  "pure",
		},
		{
			name:    "a decorated multi-line header confers trust",
			source:  importer,
			support: body("/**\n * @module\n * @throws {never}\n */"),
			stdout:  "pure",
		},
		{
			name:    "ordinary tabs and newlines inside the braces still confer trust",
			source:  importer,
			support: body("/**\n@module\n@throws {\n\tnever\n}\n*/"),
			stdout:  "pure",
		},
		{
			name:    "a line comment ABOVE a real header does not disturb it",
			source:  importer,
			support: body("// an ordinary note\n/** @module @throws {never} */"),
			stdout:  "pure",
		},
		{
			name:    "a split marker is still not the marker",
			source:  importer,
			support: body("/**\n * @throws\n * {never}\n * @module\n */"),
			reject:  []string{"SMITHERS1510@1:8"},
		},
	})
}
