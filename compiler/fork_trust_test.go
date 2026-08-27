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

// TestPinnedForkModuleTrustMarkerIsCaseSensitive pins the MODULE-initialization
// marker to the exact spelling, on the same rule that already governs the
// call-site marker.
//
// specification/failures.mdx, Foreign Exceptions (Locked): "`@throws {never}`
// removes the default panic case; `@throws {T}` declares the stated foreign
// error channel." Two productions of one syntax, separated only by the spelling
// inside the braces. `T` is a TypeScript type name and TypeScript type identity
// is case-sensitive, so `Never` is the second production and never the first;
// folding case merges them and converts a channel the compiler cannot reify
// into the trusted opt-out. TestPinnedForkThrowsNeverIsCaseSensitive and
// 09-foreign-calls/the-never-annotation-is-case-sensitive already pin that
// reading at the CALL boundary. This is the same marker at the MODULE boundary,
// where the consequence is larger: the marker suppresses SMITHERS1510, whose
// job is to stop an unchecked foreign initializer from running before any
// checked call boundary exists.
//
// Every case below is a REFUSAL, not a silent ignore: the near-miss produces
// SMITHERS1510 at the import specifier rather than compiling with a quietly
// untrusted edge. The accepted forms at the end are the over-correction guard —
// the genuine one-line and multi-line headers must keep conferring trust.
func TestPinnedForkModuleTrustMarkerIsCaseSensitive(t *testing.T) {
	const source = "import { value } from \"./foreign.ts\"\n" +
		"export function main(): string[] { return [`${value}`] }\n"
	const body = "export const value = 1\n"
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "capitalized Never does not open a module edge",
			support: "/** @module @throws {Never} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "upper-case NEVER does not open a module edge",
			support: "/** @module @throws {NEVER} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "mixed-case nEvEr does not open a module edge",
			support: "/** @module @throws {nEvEr} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "upper-case MODULE tag is not the module tag",
			support: "/** @MODULE @throws {never} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "title-case Module tag is not the module tag",
			support: "/** @Module @throws {never} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "upper-case THROWS tag is not the throws tag",
			support: "/** @module @THROWS {never} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "title-case Throws tag is not the throws tag",
			support: "/** @module @Throws {never} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "a wholly upper-cased header claims nothing",
			support: "/** @MODULE @THROWS {NEVER} */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "the miscasing survives the multi-line decorated shape",
			support: "/**\n * A real-looking header.\n *\n * @module\n * @throws {Never}\n */\n" + body,
			source:  source,
			reject:  []string{"SMITHERS1510@1:23"},
		},
		{
			name:    "the documented one-line header still confers module trust",
			support: "/** @module @throws {never} */\n" + body,
			source:  source,
			stdout:  "1",
		},
		{
			name:    "the multi-line decorated header still confers module trust",
			support: "/**\n * A real header.\n *\n * @module\n * @throws {never}\n */\n" + body,
			source:  source,
			stdout:  "1",
		},
		{
			name:    "brace padding is still the marker",
			support: "/** @module @throws { never } */\n" + body,
			source:  source,
			stdout:  "1",
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
