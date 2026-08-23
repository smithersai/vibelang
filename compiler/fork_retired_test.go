package compiler

import "testing"

// Retired grammar and the three diagnostic-identity situations.
//
// Every rejection below asserts the exact authored `CODE@line:column`, computed
// from the authored text by the shared runner, because the position IS the
// contract: a migration diagnostic that points at the wrong token tells the
// author to edit the wrong line. Every rule is paired with the legitimate
// nearby spelling it must NOT claim, and every one of those pairs is a form a
// naive implementation gets wrong.

// TestPinnedForkRetiredSyntaxIsAMigrationDiagnostic pins the eight retired
// source spellings.
//
// specification/failures.mdx, "Inference": "Smithers MUST NOT add a general
// throws clause, !T marker, prefix try expression, or postfix Result-recovery
// expression." specification/type-system.mdx, "Optional": "The earlier ?T,
// payload-capture, orelse, and .? grammar MUST NOT be part of the initial
// language." docs/DECISIONS.md, "Requirements and dependency injection"
// (Locked), retires the named `uses` clause.
//
// Each of these wrecks the parse around it, so the raw TypeScript cascade must
// NOT reach the author alongside the migration diagnostic — an author told both
// "';' expected" and "the `orelse` operator was removed" has to guess which one
// to act on.
func TestPinnedForkRetiredSyntaxIsAMigrationDiagnostic(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "the historical error declaration",
			source: "error Missing {}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [\"unreachable\"]\n" +
				"}\n",
			reject: []string{"SMITHERS1001@1:1"},
		},
		{
			name: "the orelse operator",
			source: "function lookup(id: number): Optional<string> {\n" +
				"  if (id === 1) return \"Ada\"\n" +
				"  return undefined\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const name = lookup(1) orelse \"Guest\"\n" +
				"  return [name]\n" +
				"}\n",
			reject: []string{"SMITHERS1001@7:26"},
		},
		{
			name: "the postfix catch recovery expression",
			source: "function compute(key: string): string {\n" +
				"  return key === \"ada\" ? \"Ada Lovelace\" : \"Guest\"\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const name = compute(\"zoe\") catch \"Guest\"\n" +
				"  return [name]\n" +
				"}\n",
			reject: []string{"SMITHERS1001@6:31"},
		},
		{
			name: "the prefix try propagation marker",
			source: "function compute(key: string): string {\n" +
				"  return key === \"ada\" ? \"Ada Lovelace\" : \"Guest\"\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const name = try compute(\"ada\")\n" +
				"  return [name]\n" +
				"}\n",
			reject: []string{"SMITHERS1001@6:16"},
		},
		{
			// The anchor is the DOT, not the question mark. A reader who fixed
			// the column by eye would put it one character later.
			name: "the .? postfix unwrap operator, anchored at the dot",
			source: "function lookup(id: number): Optional<string> {\n" +
				"  return id === 1 ? \"Ada\" : null\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const name = lookup(1).?\n" +
				"  return [name]\n" +
				"}\n",
			reject: []string{"SMITHERS1001@6:25"},
		},
		{
			name: "the throws row clause",
			source: "export class Missing extends Error {\n" +
				"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
				"}\n" +
				"\n" +
				"export function lookup(key: string): string throws Missing {\n" +
				"  return \"Ada Lovelace\"\n" +
				"}\n",
			reject: []string{"SMITHERS1001@5:45"},
		},
		{
			name: "the named uses requirement clause",
			source: "declare const Clock: unknown\n" +
				"\n" +
				"export function stamp(): number uses Clock {\n" +
				"  return 7\n" +
				"}\n",
			reject: []string{"SMITHERS1001@3:33"},
		},
		{
			// This one is SMITHERS1000, not SMITHERS1001, and the distinction is
			// substantive: a throw-expression was never part of the language, so
			// there is no migration to describe — it is simply not the grammar.
			// specification/control-flow.mdx, "Throw Statements": the initial
			// language "MUST NOT add a Smithers-specific throw-expression
			// grammar."
			name: "throw used as an expression is a grammar mismatch, not a migration",
			source: "export class Missing extends Error {\n" +
				"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
				"}\n" +
				"\n" +
				"export function lookup(key: string): Result<string, Missing> {\n" +
				"  const name = key === \"ada\" ? \"Ada Lovelace\" : throw new Missing(key)\n" +
				"  return name\n" +
				"}\n",
			reject: []string{"SMITHERS1000@6:49"},
		},
	})
}

// TestPinnedForkRetiredSyntaxGuardsSpareTheLegitimateSpellings is the half of
// the contract a token sweep gets wrong. Every row here contains a token the
// retired rules search for, in a position where it is legal, and every row
// must compile AND run.
func TestPinnedForkRetiredSyntaxGuardsSpareTheLegitimateSpellings(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			// `Result.try` is the documented public adapter. It is excluded by
			// the token immediately before it, which is a `.`.
			name:    "Result.try stays the public adapter",
			support: "/**\n * @module\n * @throws {never}\n */\n\n/** No @throws claim. */\nexport function parseIntegerUnchecked(text: string): number {\n  const parsed = Number.parseInt(text, 10);\n  if (Number.isNaN(parsed)) throw new RangeError(text);\n  return parsed;\n}\n",
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { parseIntegerUnchecked } from \"./foreign.ts\"\n" +
				"\n" +
				"function parse(text: string): Result<number, Panic> {\n" +
				"  return Result.try(() => parseIntegerUnchecked(text))\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [parse(\"41\").match({ ok: (value) => `${value}`, error: () => \"panic\" })]\n" +
				"}\n",
			stdout: "41",
		},
		{
			// Statement-form `try { } catch { }` stays legal. `try` is excluded
			// by the FOLLOWING `{`, and `catch` by the PRECEDING `}` — two
			// different guards on one construct, and dropping either one turns
			// ordinary error handling into a migration diagnostic.
			name: "statement-form try/catch stays legal",
			source: "export function main(): string[] {\n" +
				"  const seen: string[] = []\n" +
				"  try {\n" +
				"    seen.push(\"tried\")\n" +
				"  } catch (error) {\n" +
				"    seen.push(\"caught\")\n" +
				"  } finally {\n" +
				"    seen.push(\"finally\")\n" +
				"  }\n" +
				"  return seen\n" +
				"}\n",
			stdout: "tried\nfinally",
		},
		{
			// A Promise `.catch()` is excluded by the preceding `.`. It is not
			// legal, but the rule that rejects it is the Promise discipline —
			// reporting it as retired grammar would send the author to the wrong
			// migration entirely. This row asserts the CODES, which is the point.
			name: "a Promise .catch() is the Promise rule, not the retired one",
			source: "async function load(): Promise<string> {\n" +
				"  return \"ada\"\n" +
				"}\n" +
				"\n" +
				"export async function main(): Promise<string[]> {\n" +
				"  const name = await load().catch(() => \"guest\")\n" +
				"  return [name]\n" +
				"}\n",
			reject: []string{"SMITHERS1401@6:22", "SMITHERS1402@6:22"},
		},
		{
			// A member NAMED `try`, `catch`, or `orelse` is an ordinary member.
			// The retired forms all take a right operand, so a following `:` (a
			// property name) or a preceding `{` (nothing an expression could end
			// with) proves the token is not the operator. The reference's own
			// sweep reports these — its rules test only the preceding token —
			// and following it there would have turned every object with a
			// `catch` or `try` member into a migration diagnostic.
			name: "members named try, catch, and orelse are ordinary members",
			source: "const Adapter = {\n" +
				"  try: (body: () => number): number => body(),\n" +
				"  catch: (fallback: number): number => fallback,\n" +
				"  orelse: 7,\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${Adapter.try(() => 41)}`, `${Adapter.catch(3)}`, `${Adapter.orelse}`]\n" +
				"}\n",
			stdout: "41\n3\n7",
		},
		{
			// `throws` and `uses` are ordinary identifiers everywhere except
			// between a parameter list and a body.
			name: "throws and uses stay ordinary identifiers and members",
			source: "export function main(): string[] {\n" +
				"  const policy = { throws: \"never\", uses: \"nothing\" }\n" +
				"  const uses = policy.uses\n" +
				"  const throws = policy.throws\n" +
				"  return [uses, throws]\n" +
				"}\n",
			stdout: "nothing\nnever",
		},
		{
			// The scan must be regex-aware. Without re-scanning a `/` into a
			// regular-expression literal, the body of `/catch/` would enter the
			// token stream as a bare `catch` identifier preceded by `/` — which
			// is neither `}` nor `.`, so both guards would pass and an ordinary
			// regular expression would be reported as retired grammar.
			name: "a regular expression containing a retired spelling is not a retired spelling",
			source: "export function main(): string[] {\n" +
				"  const catchPattern = /catch/\n" +
				"  const orelsePattern = /orelse/\n" +
				"  return [\n" +
				"    catchPattern.test(\"catch me\") ? \"matched\" : \"no\",\n" +
				"    orelsePattern.test(\"nothing\") ? \"matched\" : \"no\",\n" +
				"  ]\n" +
				"}\n",
			stdout: "matched\nno",
		},
		{
			// Strings, templates, and comments carry no grammar. The scanner
			// skips trivia, and a literal is one token whose text includes its
			// delimiters, so none of these can match a bare keyword.
			name: "retired spellings inside strings, templates, and comments are text",
			source: "export function main(): string[] {\n" +
				"  // orelse and .? and prefix try are retired spellings\n" +
				"  const note = \"orelse .? try catch throws uses\"\n" +
				"  const shown = `catch ${note.length} throws`\n" +
				"  return [note, shown]\n" +
				"}\n",
			stdout: "orelse .? try catch throws uses\ncatch 31 throws",
		},
		{
			// The postfix non-null assertion `x!` is not the retired `!T` return
			// marker, and optional chaining `a?.b` is not the retired `.?`. Both
			// pairs differ only in token order.
			name: "postfix ! and optional chaining are not the retired markers",
			source: "export function main(): string[] {\n" +
				"  const entries = new Map<string, string>([[\"ada\", \"Ada Lovelace\"]])\n" +
				"  const found = entries.get(\"ada\")!\n" +
				"  const absent: { name?: string } = {}\n" +
				"  return [found, String(absent?.name)]\n" +
				"}\n",
			stdout: "Ada Lovelace\nundefined",
		},
	})
}

// TestPinnedForkValueIfRequiresAnElseBranch pins the missing-else situation.
//
// specification/control-flow.mdx, "If": "An if expression MUST select exactly
// one reachable branch. When used where a value is required, every normal
// completion path MUST produce a compatible value." The same section allows
// omitting the alternate "only where the resulting unit or optional semantics
// are explicitly defined by the final grammar" — they are not, so an omitted
// branch has no value at all.
//
// The situation is recognized structurally, from a value `if` whose alternate
// the parser had to synthesize as missing. It is NOT a TypeScript code lookup:
// the same TS1005 the parser emits here means something different everywhere
// else, and the third row below is a program where a missing `else` is
// perfectly legal.
func TestPinnedForkValueIfRequiresAnElseBranch(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a value if with no else is refused at the if keyword",
			source: "export function describe(enabled: boolean): string {\n" +
				"  const value = if (enabled) { \"yes\" }\n" +
				"  return value\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [describe(true), describe(false)]\n" +
				"}\n",
			reject: []string{"SMITHERS1705@2:17"},
		},
		{
			name: "a value if with both branches compiles and selects one",
			source: "export function describe(enabled: boolean): string {\n" +
				"  const value = if (enabled) { \"yes\" } else { \"no\" }\n" +
				"  return value\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [describe(true), describe(false)]\n" +
				"}\n",
			stdout: "yes\nno",
		},
		{
			// The identical shape in STATEMENT position keeps its TypeScript
			// meaning: a statement `if` needs no `else`, and reinterpreting it
			// would break ordinary control flow.
			name: "a statement if with no else keeps its TypeScript meaning",
			source: "export function main(): string[] {\n" +
				"  const events: string[] = []\n" +
				"  if (events.length === 0) { events.push(\"first\") }\n" +
				"  if (events.length === 5) { events.push(\"never\") }\n" +
				"  events.push(\"second\")\n" +
				"  return events\n" +
				"}\n",
			stdout: "first\nsecond",
		},
		{
			// An `else if` chain is a nested value if, so each link supplies the
			// alternate of the one before and only the last link's missing
			// `else` would be refused.
			name: "an else if chain terminated by an else compiles",
			source: "export function grade(score: number): string {\n" +
				"  const label = if (score > 90) { \"high\" } else if (score > 50) { \"mid\" } else { \"low\" }\n" +
				"  return label\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [grade(95), grade(70), grade(10)]\n" +
				"}\n",
			stdout: "high\nmid\nlow",
		},
	})
}

// TestPinnedForkMissingRelativeModuleFailsClosed pins the project-closure rule.
//
// specification/requirements.mdx, "Satisfaction": "When the compiler knows the
// complete closure, an unsatisfied capability MUST be a compile error." A
// module the compiler cannot see means the closure is NOT known, so proceeding
// would mean assuming the absent module contributed an empty failure and
// requirement row — an assumption that silently deletes whatever it carried.
func TestPinnedForkMissingRelativeModuleFailsClosed(t *testing.T) {
	const present = "export interface Entry {\n  readonly name: string\n}\n"
	runFailClosedCases(t, []failClosedCase{
		{
			// Type-only is deliberately included: the closure the row analysis
			// needs is the MODULE set, and a type-only edge still names a module
			// whose Error and Context declarations rows are built from.
			name: "an absent relative .sm module is refused at its specifier",
			source: "import type { Entry } from \"./absent-module.mod.sm\"\n" +
				"\n" +
				"const local: Entry = { name: \"ada\" }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [local.name]\n" +
				"}\n",
			reject: []string{"SMITHERS1801@1:28"},
		},
		{
			name:    "a present relative .sm module resolves and runs",
			modules: []string{"entry.mod.sm\x00" + present},
			source: "import type { Entry } from \"./entry.mod.sm\"\n" +
				"\n" +
				"const local: Entry = { name: \"ada\" }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [local.name]\n" +
				"}\n",
			stdout: "ada",
		},
		{
			// A compiler-owned specifier is not a relative path and is never
			// asked about; neither is a relative TypeScript module, which is not
			// a Smithers module and carries no rows.
			name:    "compiler-owned and relative TypeScript specifiers are untouched",
			support: "/**\n * @module\n * @throws {never}\n */\n\n/** @throws {never} */\nexport function double(value: number): number {\n  return value * 2;\n}\n",
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { double } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const panics: Panic[] = []\n" +
				"  return [`${double(21)}`, `${panics.length}`]\n" +
				"}\n",
			stdout: "42\n0",
		},
	})
}

// TestPinnedForkInferredFallibleCallbackNeedsAContract pins SMITHERS1303.
//
// specification/failures.mdx, "Inference": "Public, abstract, ambient, and
// declaration-only contracts MUST express fallibility directly with
// Result<A, E>." An argument position is such a boundary: the callee invokes the
// function where the compiler cannot see, so the only surviving description of
// its failures is the function's own declared type, and a plain
// `(key: string) => string` has nowhere to put them.
func TestPinnedForkInferredFallibleCallbackNeedsAContract(t *testing.T) {
	const apply = "export class Missing extends Error {\n" +
		"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
		"}\n" +
		"\n" +
		"function apply(keys: string[], transform: (key: string) => string): string[] {\n" +
		"  return keys.map(transform)\n" +
		"}\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "an inferred-fallible callback is refused at the argument",
			source: apply + "\n" +
				"export function main(): string[] {\n" +
				"  return apply([\"ada\", \"zoe\"], (key) => {\n" +
				"    if (key !== \"ada\") throw new Missing(key)\n" +
				"    return \"Ada Lovelace\"\n" +
				"  })\n" +
				"}\n",
			reject: []string{"SMITHERS1303@10:32"},
		},
		{
			// Declaring the contract clears it. The rule is about the CALLBACK's
			// own type, so annotating the function value is the whole fix, and
			// the callee's parameter type is never inspected.
			name: "an explicit Result contract on the callback clears the rule",
			source: "export class Missing extends Error {\n" +
				"  constructor(readonly key: string) { super(`no entry for ${key}`) }\n" +
				"}\n" +
				"\n" +
				"function apply(keys: string[], transform: (key: string) => Result<string, Missing>): string[] {\n" +
				"  return keys.map((key) => transform(key).unwrapOr(\"none\"))\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return apply([\"ada\", \"zoe\"], (key): Result<string, Missing> => {\n" +
				"    if (key !== \"ada\") throw new Missing(key)\n" +
				"    return \"Ada Lovelace\"\n" +
				"  })\n" +
				"}\n",
			stdout: "Ada Lovelace\nnone",
		},
		{
			// A callback with no failure row crosses the same boundary freely:
			// there is no channel to lose.
			name: "an infallible callback crosses the same boundary",
			source: apply + "\n" +
				"export function main(): string[] {\n" +
				"  return apply([\"ada\", \"zoe\"], (key) => key.toUpperCase())\n" +
				"}\n",
			stdout: "ADA\nZOE",
		},
		{
			// `transform` is a PARAMETER, not a checked local function, so the
			// compiler computed no row for it and there is nothing here proven
			// lost. This is why `keys.map(transform)` inside `apply` itself is
			// an ordinary call and not an infinite source of reports.
			name: "forwarding a callback parameter is not a boundary the compiler can judge",
			source: apply + "\n" +
				"export function main(): string[] {\n" +
				"  const shout = (key: string): string => key.toUpperCase()\n" +
				"  return apply([\"ada\"], shout)\n" +
				"}\n",
			stdout: "ADA",
		},
	})
}
