package compiler

import "testing"

// The rules in this file are the SAFE-direction half of the same contract: a
// program the language requires be ACCEPTED, and whose emitted code must carry
// the failure it declares all the way to the caller. A compiler that refuses
// them is merely incomplete, but one that accepts them and then loses the
// failure at runtime is the same silent wrongness as a fail-open rejection.
//
// The shared table runner and its exact-position assertions live in
// fork_failclosed_test.go.

// TestPinnedForkResultTryAdaptsAThrowingBody pins the documented public
// adapters. specification/failures.mdx, "Foreign Exceptions": a foreign call
// "MUST add the distinguished checked panic case by default … A caller MUST
// propagate panic, explicitly catch it, or use a trusted adapter."
// `Result.try` IS that adapter, so the foreign call inside its body keeps its
// authored throw and the boundary — not a second compiler-inserted wrapper —
// converts it.
func TestPinnedForkResultTryAdaptsAThrowingBody(t *testing.T) {
	const foreign = `/**
 * @module
 * @throws {never}
 */

/** No @throws claim: every call must charge the distinguished Panic channel. */
export function parseIntegerUnchecked(text: string): number {
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new RangeError(text + " is not an integer");
  return parsed;
}

/** An async boundary with no @throws claim: its rejection must become Panic. */
export async function fetchLength(text: string): Promise<number> {
  if (text === "boom") throw new RangeError("the host rejected");
  return text.length;
}
`
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "Result.try turns a throwing body into a Result",
			support: foreign,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { parseIntegerUnchecked } from \"./foreign.ts\"\n" +
				"\n" +
				"function parse(text: string): Result<number, Panic> {\n" +
				"  return Result.try(() => parseIntegerUnchecked(text))\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [\n" +
				"    parse(\"41\").match({ ok: (value) => `${value}`, error: () => \"panic\" }),\n" +
				"    parse(\"nope\").match({ ok: (value) => `${value}`, error: () => \"panic\" }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "41\npanic",
		},
		{
			name:    "Result.tryPromise turns a rejecting body into a Result",
			support: foreign,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { fetchLength } from \"./foreign.ts\"\n" +
				"\n" +
				"async function measure(text: string): Promise<Result<number, Panic>> {\n" +
				"  return await Result.tryPromise(() => fetchLength(text))\n" +
				"}\n" +
				"\n" +
				"export async function main(): Promise<string[]> {\n" +
				"  const present = await measure(\"abcd\")\n" +
				"  const rejected = await measure(\"boom\")\n" +
				"  return [\n" +
				"    present.match({ ok: (value) => `${value}`, error: () => \"panic\" }),\n" +
				"    rejected.match({ ok: (value) => `${value}`, error: () => \"panic\" }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "4\npanic",
		},
		{
			name: "an unrelated object with a try method is not the boundary",
			source: "const Adapter = { try: (body: () => number): number => body() }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${Adapter.try(() => 41)}`]\n" +
				"}\n",
			stdout: "41",
		},
	})
}

// TestPinnedForkRecoverDoesNotSwallowAPanic pins the boundary between the two
// failure channels. specification/failures.mdx, "Panic": a panic is a defect
// only an explicit boundary may observe, so `recover` — which handles ordinary
// recoverable Errors — must pass it straight through.
func TestPinnedForkRecoverDoesNotSwallowAPanic(t *testing.T) {
	const foreign = `/**
 * @module
 * @throws {never}
 */

export function parseIntegerUnchecked(text: string): number {
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new RangeError(text + " is not an integer");
  return parsed;
}
`
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "recover handles an Error and lets a Panic survive",
			support: foreign,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { parseIntegerUnchecked } from \"./foreign.ts\"\n" +
				"\n" +
				"export class Missing extends Error {\n" +
				"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
				"}\n" +
				"\n" +
				"function lookup(key: string): Result<string, Missing> {\n" +
				"  if (key !== \"ada\") throw new Missing(key)\n" +
				"  return \"Ada Lovelace\"\n" +
				"}\n" +
				"\n" +
				"function parse(text: string): Result<number, Panic> {\n" +
				"  return Result.try(() => parseIntegerUnchecked(text))\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const recovered = lookup(\"zoe\").recover((error) => `guest for ${error.key}`)\n" +
				"  const panicked = parse(\"nope\").recover(() => -1)\n" +
				"  const parsed = parse(\"41\").recover(() => -1)\n" +
				"  return [\n" +
				"    recovered.match({ ok: (value) => value, error: () => \"unreachable\" }),\n" +
				"    panicked.match({ ok: (value) => `recovered ${value}`, error: () => \"panic survived recover\" }),\n" +
				"    parsed.match({ ok: (value) => `${value}`, error: () => \"panic survived recover\" }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "guest for zoe\npanic survived recover\n41",
		},
	})
}

// TestPinnedForkExplicitPanicChargesTheChannel pins that `panic(...)` reaches
// the caller's `match` error branch rather than aborting the process.
// specification/failures.mdx, "Foreign Exceptions": "panic is imported from
// smithers:exceptions and accepts an optional message or underlying Error."
// The declared `Result<string, Panic>` is only true if the caller can observe
// it, so this test executes the emitted program rather than reading its text.
func TestPinnedForkExplicitPanicChargesTheChannel(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a panic statement becomes the error variant",
			source: "import { Panic, panic } from \"smithers:exceptions\"\n" +
				"\n" +
				"function force(key: string): Result<string, Panic> {\n" +
				"  if (key !== \"ada\") panic(`no entry for ${key}`)\n" +
				"  return \"Ada Lovelace\"\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [\n" +
				"    force(\"ada\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` }),\n" +
				"    force(\"zoe\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` }),\n" +
				"  ]\n" +
				"}\n",
			stdout: "Ada Lovelace\npanic: no entry for zoe",
		},
		{
			name: "a directly returned panic becomes the error variant",
			source: "import { Panic, panic } from \"smithers:exceptions\"\n" +
				"\n" +
				"function force(key: string): Result<string, Panic> {\n" +
				"  if (key !== \"ada\") return panic(\"defect\")\n" +
				"  return \"Ada Lovelace\"\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [force(\"zoe\").match({ ok: (value) => value, error: (error) => `panic: ${error.message}` })]\n" +
				"}\n",
			stdout: "panic: defect",
		},
		{
			name: "a panic in a value position has no defined Result lowering",
			source: "import { Panic, panic } from \"smithers:exceptions\"\n" +
				"\n" +
				"function force(key: string): Result<string, Panic> {\n" +
				"  const value = key === \"ada\" ? \"Ada Lovelace\" : panic(\"defect\")\n" +
				"  return value\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [force(\"ada\").match({ ok: (value) => value, error: () => \"panic\" })]\n" +
				"}\n",
			reject: []string{"SMITHERS1503@4:50"},
		},
		{
			name: "a user-declared panic function stays an ordinary function",
			source: "function panic(message: string): string {\n" +
				"  return `handled ${message}`\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [panic(\"defect\")]\n" +
				"}\n",
			stdout: "handled defect",
		},
	})
}

// TestPinnedForkUnwrapInARepeatedLoopHeaderIsRejected separates the two
// placement refusals. specification/failures.mdx, "Propagation": "The emitted
// error path MUST return the enclosing error variant rather than throw a
// recoverable JavaScript exception." A loop condition or incrementor runs once
// per iteration, so the guard cannot be hoisted in front of the loop — but a
// `for` initializer runs exactly once and a loop body is an ordinary statement
// list, and both must keep working.
func TestPinnedForkUnwrapInARepeatedLoopHeaderIsRejected(t *testing.T) {
	const limitModule = "export class Missing extends Error {\n" +
		"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
		"}\n" +
		"\n" +
		"function limit(key: string): Result<number, Missing> {\n" +
		"  if (key !== \"ada\") throw new Missing(key)\n" +
		"  return 3\n" +
		"}\n\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "an unwrap in a for condition is rejected",
			source: limitModule +
				"export function count(key: string): Result<number, Missing> {\n" +
				"  let total = 0\n" +
				"  for (let index = 0; index < limit(key).unwrap(); index++) {\n" +
				"    total += index\n" +
				"  }\n" +
				"  return total\n" +
				"}\n",
			reject: []string{"SMITHERS1703@12:31"},
		},
		{
			name: "an unwrap in a while condition is rejected",
			source: limitModule +
				"export function count(key: string): Result<number, Missing> {\n" +
				"  let total = 0\n" +
				"  while (total < limit(key).unwrap()) {\n" +
				"    total += 1\n" +
				"  }\n" +
				"  return total\n" +
				"}\n",
			reject: []string{"SMITHERS1703@12:18"},
		},
		{
			// A `for` initializer runs exactly once, so it is NOT a repeated
			// header and must not draw SMITHERS1703. It still draws the general
			// placement refusal SMITHERS1204, because this lowering has nowhere
			// to hoist the guard: the declaration lives inside the loop header.
			// The JS reference does lower this form, so the two implementations
			// differ here in the SAFE direction — recorded, not papered over.
			name: "a for initializer is a placement refusal, not a repeated-header one",
			source: limitModule +
				"export function count(key: string): Result<number, Missing> {\n" +
				"  let total = 0\n" +
				"  for (let index = limit(key).unwrap(); index > 0; index--) {\n" +
				"    total += index\n" +
				"  }\n" +
				"  return total\n" +
				"}\n",
			reject: []string{"SMITHERS1204@12:20"},
		},
		{
			name: "an unwrap in the loop body is an ordinary statement and is accepted",
			source: limitModule +
				"export function count(key: string): Result<number, Missing> {\n" +
				"  let total = 0\n" +
				"  for (const step of [1, 2]) {\n" +
				"    const bound = limit(key).unwrap()\n" +
				"    total += step * bound\n" +
				"  }\n" +
				"  return total\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [count(\"ada\").match({ ok: (value) => `${value}`, error: (error) => error.key })]\n" +
				"}\n",
			stdout: "9",
		},
	})
}

// TestPinnedForkComputedErrorMatchCaseAlsoReportsTheUncoveredMember pins the
// cascade. specification/failures.mdx, "Error Prototype": "Handler selection
// MUST use compiler-stable nominal identity, not a forgeable user _tag or
// minifier-sensitive constructor name in compiled artifacts." A computed key is
// refused — and the union member it was meant to cover is now uncovered, which
// is the half of the answer that tells the author what to write instead.
func TestPinnedForkComputedErrorMatchCaseAlsoReportsTheUncoveredMember(t *testing.T) {
	const errors = "export class NotFound extends Error {\n" +
		"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
		"}\n" +
		"\n" +
		"export class Timeout extends Error {\n" +
		"  constructor(readonly milliseconds: number) { super(`timed out after ${milliseconds}ms`) }\n" +
		"}\n" +
		"\n" +
		"function load(key: string): Result<string, NotFound | Timeout> {\n" +
		"  if (key === \"slow\") throw new Timeout(250)\n" +
		"  if (key !== \"ada\") throw new NotFound(key)\n" +
		"  return \"Ada Lovelace\"\n" +
		"}\n\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a computed case key is refused and its member reported uncovered",
			source: errors +
				"const label = \"NotFound\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [load(\"zoe\").match({\n" +
				"    ok: (value) => value,\n" +
				"    error: (error) => error.match({\n" +
				"      [label]: (failure: NotFound) => `guest for ${failure.key}`,\n" +
				"      Timeout: (failure) => `${failure.milliseconds}`,\n" +
				"    }),\n" +
				"  })]\n" +
				"}\n",
			reject: []string{"SMITHERS1252@20:35", "SMITHERS1253@20:35"},
		},
		{
			name: "static class-name cases stay exhaustive and run",
			source: errors +
				"export function main(): string[] {\n" +
				"  return [load(\"zoe\").match({\n" +
				"    ok: (value) => value,\n" +
				"    error: (error) => error.match({\n" +
				"      NotFound: (failure) => `guest for ${failure.key}`,\n" +
				"      Timeout: (failure) => `${failure.milliseconds}`,\n" +
				"    }),\n" +
				"  })]\n" +
				"}\n",
			stdout: "guest for zoe",
		},
	})
}

// TestPinnedForkRetiredTypeGrammarIsReportedAsAMigration pins that the two
// retired type markers produce the migration diagnostic rather than a raw
// TypeScript grammar error. specification/type-system.mdx, "Optional"
// (Locked): "The earlier ?T, payload-capture, orelse, and .? grammar MUST NOT
// be part of the initial language."
//
// The accepted rows matter as much: a postfix non-null assertion and a postfix
// definite-assignment marker are ordinary TypeScript and share the parser's
// nodes with the retired forms.
func TestPinnedForkRetiredTypeGrammarIsReportedAsAMigration(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "the bang return marker is retired",
			source: "export class Missing extends Error {\n" +
				"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
				"}\n" +
				"\n" +
				"export function lookup(key: string): !string {\n" +
				"  if (key !== \"ada\") throw new Missing(key)\n" +
				"  return \"Ada Lovelace\"\n" +
				"}\n",
			reject: []string{"SMITHERS1001@5:38", "SMITHERS1101@5:1"},
		},
		{
			name: "the question optional grammar is retired",
			source: "export function lookup(id: number): ?string {\n" +
				"  if (id === 1) return \"Ada\"\n" +
				"  return null\n" +
				"}\n",
			reject: []string{"SMITHERS1001@1:37"},
		},
		{
			name: "a postfix non-null assertion is ordinary TypeScript",
			source: "export function main(): string[] {\n" +
				"  const entries = new Map<string, string>([[\"ada\", \"Ada Lovelace\"]])\n" +
				"  const found = entries.get(\"ada\")!\n" +
				"  return [found]\n" +
				"}\n",
			stdout: "Ada Lovelace",
		},
	})
}
