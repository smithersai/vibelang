package compiler

import "testing"

// Foreign value provenance and ambient authority MUST NOT depend on how a
// property is spelled, on the Go fork.
//
// `{ handler: handler }` and `{ handler }` are one program. The name of an
// ES2015 shorthand property assignment declares a property and reads a value
// with one token, and `GetSymbolAtLocation` answers the *property* — a symbol
// whose only declaration is the ShorthandPropertyAssignment itself. Two walks
// in this fork dead-ended there, and the dead end is FAIL-OPEN:
//
//   - `foreignSymbolValueCanExecute` only followed a variable declaration, so a
//     directly IMPORTED callable in `{ getHandler }` was accepted while
//     `{ getHandler: getHandler }` was refused;
//   - `reportForbiddenHostGlobal` skipped every identifier
//     `isDeclarationNameIdentifier` claimed, so `Object.freeze({ process })`
//     slipped past SMITHERS1601 while its longhand was refused —
//     `ambientAuthorityUses` had already carved the shorthand back out for the
//     Date/Math/performance/crypto rule, and this branch had not.
//
// These tests mirror poc/src/language/foreign-shorthand-provenance.test.ts. The
// load-bearing half is the negative half: a rule that refuses shorthand
// properties is trivially "sound" and useless, so every refusal is paired with
// the ordinary shorthands that must stay accepted.

const shorthandProvenanceForeign = `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function getHandler(): (name: string) => void {
  return (name) => { void name; };
}

/** @throws {never} */
export function getRecord(): { readonly id: string } {
  return { id: "r" };
}

/** @throws {never} */
export function register(handlers: { readonly handler: (name: string) => void }): void {
  handlers.handler("x");
}

/** No @throws claim: the default checked panic case survives every call. */
export function registerUnsafe(handlers: { readonly handler: (name: string) => void }): void {
  handlers.handler("x");
}

/** @throws {never} */
export const VERSION: number = 1;
`

// TestPinnedForkShorthandKeepsForeignProvenance pins each shorthand at the
// SAME code and position its longhand twin reports, which is the claim that
// makes the pair one program rather than two.
func TestPinnedForkShorthandKeepsForeignProvenance(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a local const in a frozen object, longhand",
			support: shorthandProvenanceForeign,
			source: "import { getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const handler = getHandler()\n" +
				"  const ns = Object.freeze({ handler: handler })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@5:28"},
		},
		{
			name:    "a local const in a frozen object, SHORTHAND",
			support: shorthandProvenanceForeign,
			source: "import { getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const handler = getHandler()\n" +
				"  const ns = Object.freeze({ handler })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@5:28"},
		},
		{
			name:    "a directly IMPORTED callable, longhand",
			support: shorthandProvenanceForeign,
			source: "import { getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const ns = Object.freeze({ getHandler: getHandler })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@4:28"},
		},
		{
			name:    "a directly IMPORTED callable, SHORTHAND",
			support: shorthandProvenanceForeign,
			source: "import { getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const ns = Object.freeze({ getHandler })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@4:28"},
		},
		{
			name:    "a RENAMED import, SHORTHAND",
			support: shorthandProvenanceForeign,
			source: "import { getHandler as make } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const ns = Object.freeze({ make })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@4:28"},
		},
		{
			name:    "a NAMESPACE import, SHORTHAND",
			support: shorthandProvenanceForeign,
			source: "import * as foreign from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const ns = Object.freeze({ foreign })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@4:28"},
		},
		{
			name:    "an imported callable returned in a SHORTHAND",
			support: shorthandProvenanceForeign,
			source: "import { getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): { readonly getHandler: () => (name: string) => void } {\n" +
				"  return { getHandler }\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@4:10"},
		},
		{
			name:    "a foreign OBJECT that is not callable, SHORTHAND",
			support: shorthandProvenanceForeign,
			source: "import { getRecord } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const record = getRecord()\n" +
				"  const ns = Object.freeze({ record })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1508@5:28"},
		},
	})
}

// TestPinnedForkAmbientAuthorityThroughAShorthand is the second rule the same
// rewrite walked past, and it is the sharper of the two: the value read back out
// of `{ process }` was usable.
func TestPinnedForkAmbientAuthorityThroughAShorthand(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "setTimeout in a frozen object, longhand",
			source: "export function main(): void {\n" +
				"  const ns = Object.freeze({ setTimeout: setTimeout })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:42"},
		},
		{
			name: "setTimeout in a frozen object, SHORTHAND",
			source: "export function main(): void {\n" +
				"  const ns = Object.freeze({ setTimeout })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:30"},
		},
		{
			name: "the host global read back out of the shorthand is refused at the shorthand",
			source: "export function main(): string {\n" +
				"  const ns = { setTimeout }\n" +
				"  return `${typeof ns.setTimeout}`\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:16"},
		},
		{
			name: "Date in a shorthand keeps its own capability rule, unchanged",
			source: "export function main(): void {\n" +
				"  const ns = Object.freeze({ Date })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1602@2:30"},
		},
	})
}

// TestPinnedForkShorthandLeavesOrdinaryProgramsAlone is the over-correction
// guard. Every case here is a shorthand property that carries no foreign
// provenance and no ambient authority, and every one must still compile.
func TestPinnedForkShorthandLeavesOrdinaryProgramsAlone(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a number in a shorthand",
			source: "export function main(): string[] {\n" +
				"  const count = 1\n" +
				"  const ns = Object.freeze({ count })\n" +
				"  return [`${ns.count}`]\n" +
				"}\n",
			stdout: "1",
		},
		{
			name: "an owned function declaration in a shorthand",
			source: "function own(name: string): string { return name }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const ns = Object.freeze({ own })\n" +
				"  return [ns.own(\"a\")]\n" +
				"}\n",
			stdout: "a",
		},
		{
			name: "an owned arrow in a shorthand",
			source: "export function main(): string[] {\n" +
				"  const own = (name: string): string => name\n" +
				"  const ns = Object.freeze({ own })\n" +
				"  return [ns.own(\"b\")]\n" +
				"}\n",
			stdout: "b",
		},
		{
			name:    "a foreign PRIMITIVE, which cannot execute",
			support: shorthandProvenanceForeign,
			source: "import { VERSION } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const ns = Object.freeze({ VERSION })\n" +
				"  return [`${ns.VERSION}`]\n" +
				"}\n",
			stdout: "1",
		},
		{
			name:    "owned callbacks handed to a TRUSTED binding in a shorthand",
			support: shorthandProvenanceForeign,
			source: "import { register } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const sink: string[] = []\n" +
				"  const handler = (name: string): void => { sink.push(name) }\n" +
				"  register({ handler })\n" +
				"  return sink\n" +
				"}\n",
			stdout: "x",
		},
		{
			name: "an OWNED binding that merely shares a host global's name",
			source: "export function main(): string[] {\n" +
				"  const setTimeout = 1\n" +
				"  const ns = Object.freeze({ setTimeout })\n" +
				"  return [`${ns.setTimeout}`]\n" +
				"}\n",
			stdout: "1",
		},
		{
			name: "an ordinary property NAME spelled like a host global",
			source: "export function main(): string[] {\n" +
				"  const ns = Object.freeze({ setTimeout: 2 })\n" +
				"  return [`${ns.setTimeout}`]\n" +
				"}\n",
			stdout: "2",
		},
		{
			name: "a declaration actually named after a host global",
			source: "function setTimeout(value: string): string { return value }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [setTimeout(\"c\")]\n" +
				"}\n",
			stdout: "c",
		},
	})
}

// TestPinnedForkShorthandLeavesNeighbouringRulesAlone pins the rules that own
// the shapes this one does not.
func TestPinnedForkShorthandLeavesNeighbouringRulesAlone(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an UNTRUSTED host still refuses the shorthand as SMITHERS1509",
			support: shorthandProvenanceForeign,
			source: "import { getHandler, registerUnsafe } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const handler = getHandler()\n" +
				"  registerUnsafe({ handler })\n" +
				"}\n",
			reject: []string{"SMITHERS1301@5:3", "SMITHERS1509@5:18"},
		},
		{
			name:    "a shorthand METHOD calling a foreign callable is the callback rule",
			support: shorthandProvenanceForeign,
			source: "import { getHandler } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): void {\n" +
				"  const handler = getHandler()\n" +
				"  const ns = Object.freeze({ run(name: string): void { handler(name) } })\n" +
				"  void ns\n" +
				"}\n",
			reject: []string{"SMITHERS1301@5:56"},
		},
	})
}
