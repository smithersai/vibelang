package compiler

import "testing"

func TestPinnedForkModuleTrustMarkerDoesNotAnnotateFirstExport(t *testing.T) {
	const foreign = `/** @module @throws {never} */
export function danger(): string {
  throw new Error("boom")
}
`
	runFailClosedCases(t, []failClosedCase{{
		name:    "module initialization trust is not function-level throws trust",
		support: foreign,
		source: "import { Panic } from \"smithers:exceptions\"\n" +
			"import { danger } from \"./foreign.ts\"\n" +
			"\n" +
			"function call(): Result<string, Panic> {\n" +
			"  return danger()\n" +
			"}\n" +
			"\n" +
			"export function main(): string[] {\n" +
			"  return [call().match({ ok: (value) => value, error: () => \"panic\" })]\n" +
			"}\n",
		stdout: "panic",
	}})
}

func TestPinnedForkModuleTrustMarkerGrammarIsExact(t *testing.T) {
	const source = "import { value } from \"./foreign.ts\"\n" +
		"export function main(): string[] { return [`${value}`] }\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "moduleResolution tag is not a module tag",
			support: "/** @moduleResolution bundler @throws {never} */\nexport const value = 1\n",
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name: "JSDoc decoration cannot assemble a split throws marker",
			support: `/**
 * @throws
 * {never}
 * @module
 */
export const value = 1
`,
			source: source,
			reject: []string{"SMITHERS1510@1:23"},
		},
		{
			name: "exact leading module trust marker remains accepted",
			support: `/**
 * @module
 * @throws {never}
 */
export const value = 1
`,
			source: source,
			stdout: "1",
		},
	})
}

func TestPinnedForkThrowsNeverIsCaseSensitive(t *testing.T) {
	const source = "import { Panic } from \"smithers:exceptions\"\n" +
		"import { probe } from \"./foreign.ts\"\n" +
		"export function use(): Result<string, Panic> {\n" +
		"  return probe()\n" +
		"}\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name: "uppercase Never does not opt out of panic",
			support: "/** @module @throws {never} */\n" +
				"/** @throws {Never} */\n" +
				"export function probe(): string { return \"ok\" }\n",
			source: source,
			reject: []string{"SMITHERS1502@4:10"},
		},
		{
			name: "lowercase never remains the trusted spelling",
			support: "/** @module @throws {never} */\n" +
				"/** @throws {never} */\n" +
				"export function probe(): string { return \"ok\" }\n",
			source: "import { probe } from \"./foreign.ts\"\n" +
				"export function main(): string[] { return [probe()] }\n",
			stdout: "ok",
		},
	})
}

func TestPinnedForkForeignConstructorNeverMarkerIsCaseSensitive(t *testing.T) {
	const foreign = `/** @module @throws {never} */
export class Upper {
  /** @throws {Never} */
  constructor() {}
}
`
	runFailClosedCases(t, []failClosedCase{{
		name:    "uppercase Never does not trust a foreign constructor",
		support: foreign,
		source: "import { Upper } from \"./foreign.ts\"\n" +
			"export function main(): string[] {\n" +
			"  new Upper()\n" +
			"  return [\"ok\"]\n" +
			"}\n",
		reject: []string{"SMITHERS1504@3:3"},
	}})
}
