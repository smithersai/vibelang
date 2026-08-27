package compiler

import "testing"

// The foreign panic channel, on the Go fork, for the invocations that no call
// expression names.
//
// Three fail-opens shared one shape: the machinery that charges the checked
// panic case was keyed on call expressions, `new` expressions and property
// reads, so every other way JavaScript reaches foreign code slipped past it.
//
//  1. IMPLICIT INVOCATION. `for…of`, spread, `yield*`, object spread, template
//     interpolation, coercing operators and a computed key each run a method on
//     the value — `Symbol.iterator`, the value's own getters,
//     `Symbol.toPrimitive`/`valueOf`/`toString` — with no call expression in the
//     source. specification/compatibility.mdx, "Foreign Boundary" (Locked), is
//     about what the program DOES: "Calling an unannotated foreign runtime value
//     MUST add the checked `panic` case, because JavaScript and TypeScript may
//     throw, reject, or violate a declaration." Every one of these calls foreign
//     code, so every one adds the case.
//
//     The fork implements them as ONE predicate over an expression's position
//     (implicitInvocationProtocol), not as a list of reporting sites, for the
//     reason this class kept reopening: each newly noticed sibling used to be a
//     separate edit at a separate site, and the siblings nobody thought of
//     stayed fail-open silently.
//
//  2. A TRUST CLAIM ABOUT A CALL CANNOT DESCRIBE A REJECTION. `@throws {never}`
//     opts out of the panic case for the CALL; an `async` binding does not throw
//     at the call, it returns and rejects afterwards. The untrusted spelling is
//     already modelled correctly, which makes the trusted direction the
//     fail-open one.
//
//  3. A TRUST CLAIM BELONGS TO THE RESOLVED SIGNATURE. Two `@throws` tags on one
//     declaration used to resolve by SOURCE ORDER, so `{never}` then
//     `{TypeError}` trusted the binding and dropped the declared channel while
//     the identical pair reversed refused it.
//
// These mirror poc/src/language/foreign-implicit-invocation.test.ts. The
// negative half is the load-bearing half: every refusal is paired with the
// acceptance that proves the rule did not simply widen.

// implicitForeign is the untrusted module every refusal below reaches. Nothing
// in it claims `@throws {never}`; only the module-initialization header does.
const implicitForeign = `/**
 * @module
 * @throws {never}
 */

export const iterable: Iterable<number> = {
  [Symbol.iterator](): Iterator<number> { throw new Error("iterator"); },
};

export const spreadable = {
  get a(): number { throw new Error("spread-getter"); },
};

export const stringy = {
  toString(): string { throw new Error("toString"); },
  valueOf(): number { throw new Error("valueOf"); },
};

export function tag(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  throw new Error("tag");
}

export class BoomBase {
  constructor() { throw new Error("base-ctor"); }
}
`

// implicitTrusted carries claims that are true (the synchronous ones), claims
// that describe a channel they cannot cover (the async ones), and a declaration
// that makes two contradictory claims at once.
const implicitTrusted = `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function giveString(): string { return "s"; }

/** @throws {never} */
export function giveNumber(): number { return 1; }

/** @throws {never} */
export function trustedTag(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  return strings.raw.join("|") + String(values.length);
}

/** @throws {never} */
export function giveIterable(): Iterable<number> {
  return { [Symbol.iterator](): Iterator<number> { throw new Error("iter"); } };
}

/** @throws {never} */
export async function giveAsync(): Promise<string> { throw new Error("async-throw"); }

/** @throws {never} */
export function givePromise(): Promise<string> { return Promise.reject(new Error("promise")); }

/** @throws {never} */
export function giveUnionPromise(): string | Promise<string> { return Promise.reject(new Error("union")); }

export async function untrustedAsync(): Promise<string> { throw new Error("untrusted-async"); }

/**
 * @throws {never}
 * @throws {TypeError}
 */
export function neverFirst(): string { throw new TypeError("neverFirst"); }

/**
 * @throws {TypeError}
 * @throws {never}
 */
export function declaredFirst(): string { throw new TypeError("declaredFirst"); }

/**
 * @throws {never}
 * @throws {never}
 */
export function neverTwice(): string { return "ok"; }
`

func TestPinnedForkImplicitForeignInvocationKeepsThePanicCase(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "for…of runs the value's Symbol.iterator",
			support: implicitForeign,
			source: "import { iterable } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): number {\n" +
				"  let t = 0\n" +
				"  for (const n of iterable) t += n\n" +
				"  return t\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1506@5:19"},
		},
		{
			name:    "array spread runs the same iterator",
			support: implicitForeign,
			source: "import { iterable } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): number {\n" +
				"  return [...iterable].length\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1506@4:14"},
		},
		{
			name:    "object spread runs the value's own getters",
			support: implicitForeign,
			source: "import { spreadable } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): number {\n" +
				"  const copied = { ...spreadable }\n" +
				"  return copied.a\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1506@4:23"},
		},
		{
			name:    "template interpolation runs toString",
			support: implicitForeign,
			source: "import { stringy } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): number {\n" +
				"  return `x${stringy}`.length\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1506@4:14"},
		},
		{
			name:    "unary + runs valueOf",
			support: implicitForeign,
			source: "import { stringy } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): number {\n" +
				"  return +stringy\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1506@4:11"},
		},
		{
			name:    "a foreign tagged template is a call with no call expression",
			support: implicitForeign,
			source: "import { tag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string {\n" +
				"  return tag`hello`\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1504@4:10"},
		},
		{
			name:    "constructing a subclass of a foreign class runs the base constructor",
			support: implicitForeign,
			source: "import { BoomBase } from \"./foreign.ts\"\n" +
				"\n" +
				"class Derived extends BoomBase {}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof new Derived()]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@5:1", "SMITHERS1504@6:18"},
		},
		{
			// The rule is on the CONSTRUCTION, not on the `extends` clause: a
			// clause runs no constructor. Refusing the clause was measurably
			// wrong — 17-durable/the-retired-vibelang-flows-specifier-is-not-compiler-owned
			// declares a subclass of an unresolvable foreign `Action`, never
			// constructs it, and declares the module edge as its whole set.
			name:    "declaring the subclass without constructing it is not a foreign invocation",
			support: implicitForeign,
			source: "import { BoomBase } from \"./foreign.ts\"\n" +
				"\n" +
				"class Derived extends BoomBase {}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof Derived]\n" +
				"}\n",
			stdout: "function",
		},
	})
}

func TestPinnedForkImplicitInvocationLeavesOrdinaryProgramsAlone(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "ordinary iteration, spread and interpolation over authored values",
			source: "export function main(): string[] {\n" +
				"  let total = 0\n" +
				"  for (const n of [1, 2, 3]) total += n\n" +
				"  const copied = { ...{ a: 4 } }\n" +
				"  const spread = [...[5, 6]].length\n" +
				"  return [String(total), String(copied.a), String(spread)]\n" +
				"}\n",
			stdout: "6\n4\n2",
		},
		{
			name: "a locally built iterable is authored, not foreign",
			source: "export function main(): string[] {\n" +
				"  const it: Iterable<number> = { [Symbol.iterator]: () => [7, 8].values() }\n" +
				"  let total = 0\n" +
				"  for (const n of it) total += n\n" +
				"  return [String(total)]\n" +
				"}\n",
			stdout: "15",
		},
		{
			name:    "a TRUSTED synchronous binding keeps its trust in every implicit position",
			support: implicitTrusted,
			source: "import { giveString, giveNumber, trustedTag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const interpolated = `${giveString()}-${String(giveNumber())}`\n" +
				"  const iterated = [...giveString()].length\n" +
				"  return [interpolated, String(iterated), trustedTag`hi`]\n" +
				"}\n",
			stdout: "s-1\n1\nhi0",
		},
	})
}

func TestPinnedForkTrustedAsyncBindingKeepsItsRejectionChannel(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an awaited trusted async function",
			support: implicitTrusted,
			source: "import { giveAsync } from \"./foreign.ts\"\n" +
				"\n" +
				"export async function main(): Promise<string> {\n" +
				"  return await giveAsync()\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1502@4:16"},
		},
		{
			name:    "an awaited trusted Promise-returning function",
			support: implicitTrusted,
			source: "import { givePromise } from \"./foreign.ts\"\n" +
				"\n" +
				"export async function main(): Promise<string> {\n" +
				"  return await givePromise()\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1502@4:16"},
		},
		{
			// A UNION with a Promise constituent rejects and is not named
			// `Promise`, so the narrow question that drives LOWERING answers no.
			// The trust question is asked through a wider predicate for exactly
			// this reason, and it may be wider without moving an emitted byte.
			name:    "an awaited trusted string | Promise<string>",
			support: implicitTrusted,
			source: "import { giveUnionPromise } from \"./foreign.ts\"\n" +
				"\n" +
				"export async function main(): Promise<string> {\n" +
				"  return await giveUnionPromise()\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1502@4:16"},
		},
	})
}

func TestPinnedForkContradictoryThrowsClaimsRefuseInBothOrders(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "{never} then {TypeError}",
			support: implicitTrusted,
			source: "import { neverFirst } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string {\n" +
				"  return neverFirst()\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1502@4:10"},
		},
		{
			name:    "{TypeError} then {never} — the same two claims, and the same verdict",
			support: implicitTrusted,
			source: "import { declaredFirst } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string {\n" +
				"  return declaredFirst()\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1502@4:10"},
		},
		{
			name:    "two IDENTICAL claims are redundant, not contradictory, and still trust",
			support: implicitTrusted,
			source: "import { neverTwice } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [neverTwice()]\n" +
				"}\n",
			stdout: "ok",
		},
	})
}
