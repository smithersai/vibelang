package compiler

import "testing"

// A Smithers callback crossing a foreign boundary: whose obligation is its
// failure channel, on the Go fork.
//
// specification/compatibility.mdx, "Foreign Boundary" (Locked): "Calling an
// unannotated foreign runtime value MUST add the checked `panic` case, because
// JavaScript and TypeScript may throw, reject, or violate a declaration.
// Trusted `@throws {never}` metadata opts out; `@throws {T}` declares a more
// precise channel." The channel is a property of the CALL, so the claim covers
// everything that call does, including invoking a listener it was handed.
//
// specification/requirements.mdx, "Scoping" (Locked): "Imported JavaScript or
// TypeScript that starts hidden background work owns that work.
// Caller-controlled background APIs MUST expose explicit completion or disposal
// handles through their adapters." That assigns the deferred half of a
// registration to the imported module and puts the lifetime obligation on the
// adapter, not on `.sm`.
//
// specification/failures.mdx, "Panic Does Not Widen a Return Type" (Locked): a
// function "MUST therefore be able to abort with `panic(...)` while keeping a
// plain return type" — so "the callback must independently be panic-free" is
// not a rule the language can express, and a rule demanding it would admit
// nothing.
//
// These tests mirror poc/src/language/foreign-callback-trust.test.ts case for
// case. The negative half is the load-bearing half: this is a trust boundary.

// callbackTrustForeign carries BOTH a trusted callback host and an untrusted
// one, so a single support module can show that the marker — and only the
// marker — is what moves the verdict.
const callbackTrustForeign = `/**
 * @module
 * @throws {never}
 */

const seen: string[] = [];

/** @throws {never} */
export function onSignal(name: string, listener: (name: string) => void): void {
  seen.push(name);
  listener(name);
}

/** @throws {never} */
export function register(handlers: { data(value: string): void; end(): void }): void {
  handlers.data("d");
  handlers.end();
}

/** @throws {never} */
export function registerAll(listeners: readonly ((value: string) => void)[]): void {
  for (const listener of listeners) listener("a");
}

/** @throws {never} */
export function awaitable(listener: () => Promise<void>): void {
  void listener();
}

/** A foreign callable handed BACK to Smithers. @throws {never} */
export function getHandler(): (name: string) => void {
  return () => {};
}

/** No @throws claim: every call keeps the default checked panic case. */
export function onSignalUnsafe(name: string, listener: (name: string) => void): void {
  listener(name);
}
`

// callbackTrustModuleOnly carries the module-initialization claim and NOTHING
// per function, which is the boundary SMITHERS1510 answers and never a per-call
// opt-out.
const callbackTrustModuleOnly = `/**
 * @module
 * @throws {never}
 */
export function onSignalModuleOnly(name: string, listener: (name: string) => void): void {
  listener(name);
}
`

// TestPinnedForkTrustedBindingAcceptsASmithersCallback is the acceptance
// direction: every shape that can carry a Smithers function value into a
// trusted call compiles, and the emitted program RUNS. A diagnostics-only
// assertion would not show that the registration actually fires.
func TestPinnedForkTrustedBindingAcceptsASmithersCallback(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an inline arrow reaches a trusted host",
			support: callbackTrustForeign,
			source: "import { onSignal } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  onSignal(\"SIGINT\", (name) => { sink.push(`saw ${name}`) })\n" +
				"  return sink\n" +
				"}\n",
			stdout: "saw SIGINT",
		},
		{
			name:    "a named function reference reaches the same host",
			support: callbackTrustForeign,
			source: "import { onSignal } from \"./foreign.ts\"\n" +
				"\n" +
				"const sink: string[] = []\n" +
				"function handler(name: string): void { sink.push(`saw ${name}`) }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  onSignal(\"SIGINT\", handler)\n" +
				"  return sink\n" +
				"}\n",
			stdout: "saw SIGINT",
		},
		{
			name:    "callbacks inside an object-literal argument",
			support: callbackTrustForeign,
			source: "import { register } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  register({ data: (value) => { sink.push(value) }, end: () => { sink.push(\"end\") } })\n" +
				"  return sink\n" +
				"}\n",
			stdout: "d\nend",
		},
		{
			name:    "callbacks inside an array-literal argument",
			support: callbackTrustForeign,
			source: "import { registerAll } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  registerAll([(value) => { sink.push(value) }])\n" +
				"  return sink\n" +
				"}\n",
			stdout: "a",
		},
		{
			name:    "a callback stored in a const and then passed",
			support: callbackTrustForeign,
			source: "import { onSignal } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  const handler = (name: string): void => { sink.push(`saw ${name}`) }\n" +
				"  onSignal(\"SIGINT\", handler)\n" +
				"  return sink\n" +
				"}\n",
			stdout: "saw SIGINT",
		},
		{
			name:    "a callback that aborts with panic keeps the plain contract",
			support: callbackTrustForeign,
			source: "import { panic } from \"smithers:exceptions\"\n" +
				"import { onSignal } from \"./foreign.ts\"\n" +
				"\n" +
				"function install(sink: string[]): void {\n" +
				"  onSignal(\"SIGINT\", (name) => { if (name === \"\") panic(\"empty signal\") ; sink.push(name) })\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  install(sink)\n" +
				"  return sink\n" +
				"}\n",
			stdout: "SIGINT",
		},
	})
}

// TestPinnedForkUntrustedBindingStillRefusesACallback is the refusal direction,
// and it is why the acceptance above is safe: the two programs differ only in
// which export of the SAME module they call.
func TestPinnedForkUntrustedBindingStillRefusesACallback(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an inline arrow handed to an untrusted host is rejected",
			support: callbackTrustForeign,
			source: "import { onSignalUnsafe } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  onSignalUnsafe(\"SIGINT\", (name) => { sink.push(name) })\n" +
				"  return sink\n" +
				"}\n",
			reject: []string{"SMITHERS1301@5:3", "SMITHERS1509@5:28"},
		},
		{
			name:    "a module-level trust claim is not a per-call opt-out",
			support: callbackTrustModuleOnly,
			source: "import { onSignalModuleOnly } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  onSignalModuleOnly(\"SIGINT\", (name) => { sink.push(name) })\n" +
				"  return sink\n" +
				"}\n",
			reject: []string{"SMITHERS1301@5:3", "SMITHERS1509@5:32"},
		},
	})
}

// TestPinnedForkForeignCallableIntoATrustedBindingIsStillRefused guards the
// fail-open the narrow fix would have opened. SMITHERS1509 used to claim EVERY
// callable argument at a foreign call, so it also covered a callable minted in
// another module. Now that a trusted call no longer claims the position, the
// neighbouring provenance rule takes it back: a `@throws {never}` claim is about
// THIS callee and cannot speak for another module's panic behaviour.
func TestPinnedForkForeignCallableIntoATrustedBindingIsStillRefused(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a foreign callable returned, stored, then handed to a trusted host",
			support: callbackTrustForeign,
			source: "import { onSignal, getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const handler = getHandler()\n" +
				"  onSignal(\"SIGINT\", handler)\n" +
				"  return []\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@5:22"},
		},
		{
			name:    "a foreign callable handed over directly",
			support: callbackTrustForeign,
			source: "import { onSignal, getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  onSignal(\"SIGINT\", getHandler())\n" +
				"  return []\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@4:22"},
		},
	})
}

// TestPinnedForkCallbackTrustLeavesNeighbouringRulesAlone pins the obligations
// the trust claim does NOT absorb. Each one belongs to the callback itself or to
// its body, and none of them consults the boundary's trust.
func TestPinnedForkCallbackTrustLeavesNeighbouringRulesAlone(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an async callback still has no proven owner",
			support: callbackTrustForeign,
			source: "import { awaitable } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  awaitable(async () => { sink.push(\"tick\") })\n" +
				"  return sink\n" +
				"}\n",
			reject: []string{"SMITHERS1404@5:13"},
		},
		{
			name:    "a host global inside the callback body is still refused",
			support: callbackTrustForeign,
			source: "import { onSignal } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  onSignal(\"SIGINT\", () => { sink.push(`${Date.now()}`) })\n" +
				"  return sink\n" +
				"}\n",
			reject: []string{"SMITHERS1602@5:43"},
		},
		{
			name:    "an inferred-fallible callback still needs a spelled Result contract",
			support: callbackTrustForeign,
			source: "import { registerAll } from \"./foreign.ts\"\n" +
				"\n" +
				"class Bad extends Error {}\n" +
				"\n" +
				"function fallible(value: string): Result<string, Bad> {\n" +
				"  if (value === \"\") throw new Bad(\"empty\")\n" +
				"  return value\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  registerAll([(value) => { sink.push(fallible(value)!) }])\n" +
				"  return sink\n" +
				"}\n",
			// The reference reports the identical pair at the identical
			// positions; SMITHERS1204 is the postfix-`!`-inside-an-argument rule
			// and rides along with the contract refusal on both backends.
			reject: []string{"SMITHERS1204@12:39", "SMITHERS1303@12:16"},
		},
	})
}
