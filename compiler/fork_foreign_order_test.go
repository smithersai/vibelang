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
			name:    "unchecked foreign result cannot feed an arithmetic expression",
			support: foreignOrderSupport,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { untrustedLength } from \"./foreign.ts\"\n" +
				"export function go(): Result<number, Panic> {\n" +
				"  return untrustedLength(\"x\") + 1\n" +
				"}\n",
			reject: []string{"SMITHERS1301@4:10", "SMITHERS1507@4:10"},
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
