package compiler

import "testing"

const foreignOrderSupport = `/** @module @throws {never} */
/** @throws {never} */
export function trustedLength(value: string): number { return value.length }

export function makeCallable(): (value: string) => string {
  return (value) => value.toUpperCase()
}

export function untrustedLength(value: string): number { return value.length }
`

func TestPinnedForkForeignCallsRejectOrderUnsafeShapes(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			// The SURVIVING branch of SMITHERS1507, and the reason this case is
			// written separately from the arithmetic one below: the outer call's
			// callee is `makeCallable()`, which is not a stable reference the
			// compiler can read once, so the lowered form would put a Result in
			// callee position. That is PROVENANCE, and it is unaffected by the
			// placement withdrawal.
			//
			// The diagnostic is charged at the OUTER call. It used to be charged
			// at the inner one — through the retired "used as a value" branch,
			// the inner call's result being read as a callee — with a
			// same-position suppression on the outer so the two would not double
			// up. Both are gone; see `foreignPolicy`. The authored position is
			// identical either way, because a call expression starts where its
			// callee starts.
			name:    "unchecked foreign factory result cannot become the next callee",
			support: foreignOrderSupport,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { makeCallable } from \"./foreign.ts\"\n" +
				"export function go(): Result<string, Panic> {\n" +
				"  return makeCallable()(\"x\")\n" +
				"}\n",
			reject: []string{"SMITHERS1301@4:10", "SMITHERS1507@4:10"},
		},
		{
			// The RETIRED branch. `untrustedLength` is a stable identifier and
			// its result is not itself an unchecked foreign value, so neither
			// surviving condition holds; all that is left is that the call
			// produces a `Result<number, Panic>` nothing consumes, which is
			// SMITHERS1301 and is charged on its own.
			//
			// SMITHERS1507 used to ride along because the checked result was
			// USED AS A VALUE. That was a placement constraint of the hoisted
			// `Result.try(...)` wrapper wearing a provenance rule's name, and
			// specification/failures.mdx §Refusal Conditions withdrew the
			// hoisting argument it rested on (DECISIONS.md §Typed failures,
			// 2026-08-30). The reference dropped the branch in the same change;
			// 09-foreign-calls/an-untrusted-foreign-result-used-in-an-expression-is-rejected
			// is the conformance case that pins the pair on both backends.
			name:    "an unchecked foreign result in an expression is charged only where it is dropped",
			support: foreignOrderSupport,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { untrustedLength } from \"./foreign.ts\"\n" +
				"export function go(): Result<number, Panic> {\n" +
				"  return untrustedLength(\"x\") + 1\n" +
				"}\n",
			reject: []string{"SMITHERS1301@4:10"},
		},
	})
}

func TestPinnedForkForeignCallableProvenanceCannotEscape(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "foreign callable cannot pass through an unchecked local host",
			support: foreignOrderSupport,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { trustedLength } from \"./foreign.ts\"\n" +
				"function localHost(callback: (value: string) => number): number { return callback(\"x\") }\n" +
				"export function go(): Result<number, Panic> { return localHost(trustedLength) }\n",
			reject: []string{"SMITHERS1508@4:64"},
		},
		{
			name:    "mutable alias cannot retain foreign callable provenance",
			support: foreignOrderSupport,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { trustedLength } from \"./foreign.ts\"\n" +
				"export function go(): Result<number, Panic> {\n" +
				"  let callback = trustedLength\n" +
				"  return callback(\"x\")\n" +
				"}\n",
			reject: []string{"SMITHERS1508@4:18"},
		},
		{
			name:    "assignment cannot store foreign callable provenance",
			support: foreignOrderSupport,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { trustedLength } from \"./foreign.ts\"\n" +
				"export function go(): Result<number, Panic> {\n" +
				"  let callback = (value: string): number => value.length\n" +
				"  callback = trustedLength\n" +
				"  return callback(\"x\")\n" +
				"}\n",
			reject: []string{"SMITHERS1508@5:14"},
		},
		{
			name:    "return cannot expose a foreign callable",
			support: foreignOrderSupport,
			source: "import { trustedLength } from \"./foreign.ts\"\n" +
				"export function go(): (value: string) => number {\n" +
				"  return trustedLength\n" +
				"}\n",
			reject: []string{"SMITHERS1101@2:1", "SMITHERS1508@3:10"},
		},
	})
}

func TestPinnedForkForeignOrderSafeAdaptersRemainAccepted(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{{
		name:    "stable direct call and local adapter preserve evaluation order",
		support: foreignOrderSupport,
		source: "import { Panic } from \"smithers:exceptions\"\n" +
			"import { trustedLength, untrustedLength } from \"./foreign.ts\"\n" +
			"function stable(): Result<number, Panic> { return untrustedLength(\"abcd\") }\n" +
			"function localHost(callback: (value: string) => number): number { return callback(\"abcd\") }\n" +
			"const adapter = (value: string): number => trustedLength(value)\n" +
			"export function main(): string[] {\n" +
			"  return [stable().match({ ok: (value) => `${value}`, error: () => \"panic\" }), `${localHost(adapter)}`]\n" +
			"}\n",
		stdout: "4\n4",
	}})
}
