package compiler

import (
	"context"
	"strings"
	"testing"
)

// The foreign boundary, on the Go fork, when a TYPE-ONLY WRAPPER stands between
// the program and the foreign value.
//
// `foreignValueProvenance` — the walk that answers "did this value come out of
// a TypeScript module?" — spelled its own
// `KindParenthesizedExpression, KindAsExpression, …` case list, and so did a
// dozen other walks in this bridge. When TypeScript 4.9 added `satisfies`, some
// of those copies learned it and some did not: `withoutTypeAssertions`,
// `collectCallbackValues` and `contextReceiverOf` knew all four wrappers, while
// `foreignValueProvenance`, `containsCallableValue`,
// `containsForeignExecutableValue`, `assetValueProvenance`,
// `stableForeignCallee`, `foreignCalleeHasUncheckedResult` and
// `foreignBoundaryExpression` did not. `withoutTypeAssertions` sits three
// functions below `foreignValueProvenance` in the same file.
//
// The consequence, measured on this backend before the fix — nine independent
// programs, one per rule the laundering silenced, each accepted with ZERO
// diagnostics inside a function declared to return a plain type, and each
// throwing a raw host `Error` at run time with exit code 1:
//
//	(client satisfies T).dangerous                Error: getter blew
//	new (Untrusted satisfies T)("bad").v          Error: ctor blew
//	(utag satisfies T)`x`                         Error: tag blew
//	for (const s of (iterable satisfies T))       Error: iter blew
//	`v${(coercible satisfies T)}`                 Error: toString blew
//	localHof(untrusted satisfies T)               Error: host blew up
//	((client satisfies T) ?? localClient).p       Error: getter blew
//	{ pick: client satisfies T }                  Error: getter blew
//	function g(): T { return client satisfies T } Error: getter blew
//
// while `client.dangerous`, `new Untrusted("bad")`, `` utag`x` `` and the rest
// were each refused. SMITHERS1504, SMITHERS1506, SMITHERS1508 and the foreign
// `Panic` row were escapable by typing ten characters that change no value at
// all — `satisfies` does not even change the expression's TYPE, so nothing
// downstream could notice it had been written. Across a 33-spelling × 25-probe
// matrix this backend answered 294 cells fail-open; after the fix, 24, and
// every one of those 24 has a spelling containing NO `satisfies` that is
// equally open (a type annotation on a CALLEE erases foreign provenance here —
// a separate, pre-existing defect with its own owner).
//
// The fix is that the table is now ONE function — `typeOnlyWrapperOperand` in
// lowering.go, the sibling of `valueBranches` — CALLED by every walk. It is
// deliberately not another copy taught the missing entry: a copy is how this
// defect was introduced, and the next copy is how the next one would be. The
// tests below are written the same way. The refusal half asserts that every
// wrapper spelling answers EXACTLY what the direct spelling answers, rather
// than hard-coding a code list per spelling, so a rule that later changes its
// answer changes it for all of them or fails here.
//
// It also closed the OPPOSITE direction, which is why the negative half below
// is not decoration. `stableForeignCallee` had the same missing entry pointing
// the other way: a `@throws {never}` callee named through `satisfies` is still
// one leaf, still read once, and still carries its marker — and this backend
// refused it SMITHERS1507 where the reference accepted it and ran it.
//
// One position per governing rule is pinned here rather than all nineteen: the
// exhaustive matrix belongs in the lane report, and a test that recompiles 800
// modules costs more gate time than this package has.
//
// Mirrors `typeOnlyWrapperOperand` and
// poc/src/language/type-only-wrappers.test.ts in the reference.

// wrapperForeign is the untrusted module every refusal below reaches. Only the
// module-initialization header claims `@throws {never}`; no export does.
const wrapperForeign = `/**
 * @module
 * @throws {never}
 */

export class Untrusted { constructor(readonly v: string) { throw new Error("ctor"); } }

export const client = { get dangerous(): string { throw new Error("getter"); } };

export function utag(parts: TemplateStringsArray): string { throw new Error("tag"); }

export function untrusted(value: string): string { throw new Error("call"); }
export function other(value: string): string { return value; }

/** @throws {never} */
export function trustedFn(value: string): string { return value.toUpperCase(); }
/** @throws {never} */
export function trustedTag(parts: TemplateStringsArray): string { return "t"; }
`

// typeOnlyWrappers are the spellings that change only the TYPE and never the
// value. Every one of them must reach the same verdict as "direct", because
// every one of them evaluates to exactly the same value at run time.
//
// The LOCAL alternate is load-bearing and not decoration. With a FOREIGN
// alternate on the other side of a `??`, the branch fold reaches provenance
// through the alternate and the cell passes VACUOUSLY — a probe that looks like
// evidence and is not. Measured on this backend: the four `satisfies`-inside-a-
// selection spellings read 0/19 fail-open against a foreign alternate and 15/19
// against a local one. Sixty cells of the defect were invisible to the
// comfortable probe.
var typeOnlyWrappers = []struct {
	name     string
	spelling func(foreign, localAlternate, typeText string) string
}{
	{"direct", func(f, _, _ string) string { return f }},
	{"parenthesised", func(f, _, _ string) string { return "(" + f + ")" }},
	{"satisfies T", func(f, _, ty string) string { return "(" + f + " satisfies " + ty + ")" }},
	{"satisfies unknown", func(f, _, _ string) string { return "(" + f + " satisfies unknown)" }},
	{"double satisfies", func(f, _, ty string) string { return "((" + f + " satisfies " + ty + ") satisfies unknown)" }},
	{"satisfies over a parenthesis", func(f, _, ty string) string { return "((" + f + ") satisfies " + ty + ")" }},
	{"as T", func(f, _, ty string) string { return "(" + f + " as " + ty + ")" }},
	{"angle-bracket cast", func(f, _, ty string) string { return "(<" + ty + ">" + f + ")" }},
	{"satisfies then as", func(f, _, ty string) string { return "((" + f + " satisfies " + ty + ") as " + ty + ")" }},
	{"await over a satisfies", func(f, _, ty string) string { return "(await (" + f + " satisfies " + ty + "))" }},
	{"comma, satisfies on the right", func(f, l, ty string) string { return "((" + l + ", (" + f + " satisfies " + ty + ")))" }},
	{"satisfies against a LOCAL alternate", func(f, l, ty string) string { return "((" + f + " satisfies " + ty + ") ?? " + l + ")" }},
	{"ternary against a LOCAL alternate", func(f, l, ty string) string { return "(flag ? (" + f + " satisfies " + ty + ") : " + l + ")" }},
	{"selection with a LOCAL alternate, NO satisfies", func(f, l, _ string) string { return "(" + f + " ?? " + l + ")" }},
}

// typeOnlyWrapperPositions are the USE positions, one per governing rule. Each
// renders a whole `.sm` module around a wrapped value, so a failure says which
// rule moved. `localAlternate` is authored, never foreign — see above.
var typeOnlyWrapperPositions = []struct {
	name           string
	imports        string
	foreign        string
	localAlternate string
	typeText       string
	locals         string
	body           func(wrapped string) string
	// governs is the code the DIRECT spelling must already report, asserted so
	// an accidentally-clean baseline cannot make the equality below vacuous.
	governs string
}{
	{
		name: "a foreign constructor", imports: "Untrusted",
		foreign: "Untrusted", localAlternate: "LocalCtor",
		typeText: "new (v: string) => { readonly v: string }",
		locals:   "class LocalCtor { constructor(readonly v: string) {} }\n",
		body:     func(w string) string { return "  const made = new " + w + "(\"a\")\n  return [\"made\"]\n" },
		governs:  "SMITHERS1504",
	},
	{
		name: "a foreign property read", imports: "client",
		foreign: "client", localAlternate: "localClient",
		typeText: "{ readonly dangerous: string }",
		locals:   "const localClient = { get dangerous(): string { return \"safe\" } }\n",
		body:     func(w string) string { return "  return [" + w + ".dangerous]\n" },
		governs:  "SMITHERS1506",
	},
	{
		name: "a foreign tagged-template tag", imports: "utag",
		foreign: "utag", localAlternate: "localTag",
		typeText: "(parts: TemplateStringsArray) => string",
		locals:   "function localTag(parts: TemplateStringsArray): string { return \"l\" }\n",
		body:     func(w string) string { return "  return [" + w + "`x`]\n" },
		governs:  "SMITHERS1504",
	},
	{
		name: "a foreign callable handed to a local higher-order call", imports: "untrusted",
		foreign: "untrusted", localAlternate: "localFn",
		typeText: "(value: string) => string",
		locals:   "function localFn(value: string): string { return value }\n",
		body:     func(w string) string { return "  return [localHof(" + w + ")]\n" },
		governs:  "SMITHERS1508",
	},
}

func wrapperModule(imports, locals, body string) string {
	return "import { " + imports + " } from \"./foreign.ts\"\n" +
		"\n" +
		locals +
		"function localHof(fn: (value: string) => string): string { return fn(\"x\") }\n" +
		"\n" +
		"export async function main(flag: boolean = true): Promise<string[]> {\n" +
		body +
		"}\n"
}

// smithersDiagnosticCodes is `diagnosticCodes` with TypeScript's OWN
// diagnostics dropped. The wrapper spellings below are not all idiomatic
// TypeScript — `(a, (b satisfies T))` draws TS2695 ("left side of comma
// operator is unused and has no side effects") from the checker itself — and
// TypeScript's opinion about a spelling is not this rule's answer about where a
// value came from. Only the SMITHERS codes are compared, and nothing here
// suppresses a SMITHERS code.
func smithersDiagnosticCodes(t *testing.T, backend Compiler, ctx context.Context, source, support string) []string {
	t.Helper()
	kept := make([]string, 0, 4)
	for _, code := range diagnosticCodes(t, backend, ctx, source, support) {
		if strings.HasPrefix(code, "SMITHERS") {
			kept = append(kept, code)
		}
	}
	return kept
}

// TestPinnedForkTypeOnlyWrapperAnswersLikeTheDirectSpelling is the ONE TABLE
// assertion. It is written as an equality against the direct spelling rather
// than as a per-spelling code list on purpose: the property being pinned is
// that a wrapper which changes only the type carries the operand's provenance,
// not that any of these happens to report SMITHERS1506 today.
//
// Its final subtest is the attribution control, and it shares this backend: the
// same wrappers over an AUTHORED value must stay clean, so a fix that merely
// widened "wrapped means foreign" fails here rather than passing the half above.
func TestPinnedForkTypeOnlyWrapperAnswersLikeTheDirectSpelling(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, position := range typeOnlyWrapperPositions {
		t.Run(position.name, func(t *testing.T) {
			direct := smithersDiagnosticCodes(t, backend, ctx,
				wrapperModule(position.imports, position.locals,
					position.body(position.foreign)), wrapperForeign)
			found := false
			for _, code := range direct {
				if code == position.governs {
					found = true
				}
			}
			if !found {
				t.Fatalf("the DIRECT spelling must already report %s, but reported %v; "+
					"an accepting baseline would make every equality below vacuous", position.governs, direct)
			}
			for _, wrapper := range typeOnlyWrappers {
				if wrapper.name == "direct" {
					continue
				}
				t.Run(wrapper.name, func(t *testing.T) {
					wrapped := wrapper.spelling(position.foreign, position.localAlternate, position.typeText)
					got := smithersDiagnosticCodes(t, backend, ctx,
						wrapperModule(position.imports, position.locals,
							position.body(wrapped)), wrapperForeign)
					if strings.Join(got, " ") != strings.Join(direct, " ") {
						t.Fatalf("%s answers %v; the direct spelling answers %v — a wrapper that "+
							"changes only the TYPE changes no value, so the two must be the same set",
							wrapped, got, direct)
					}
				})
			}
		})
	}
	t.Run("an AUTHORED value is unmoved by every one of the same wrappers", func(t *testing.T) {
		locals := "const box = { p: \"a\" }\nconst otherBox = { p: \"b\" }\n"
		for _, wrapper := range typeOnlyWrappers {
			t.Run(wrapper.name, func(t *testing.T) {
				wrapped := wrapper.spelling("box", "otherBox", "{ readonly p: string }")
				source := "import { other } from \"./foreign.ts\"\n\n" + locals +
					"function localHof(fn: (value: string) => string): string { return fn(\"x\") }\n" +
					"\n" +
					"export async function main(flag: boolean = true): Promise<string[]> {\n" +
					"  return [" + wrapped + ".p]\n" +
					"}\n"
				if got := smithersDiagnosticCodes(t, backend, ctx, source, wrapperForeign); len(got) != 0 {
					t.Fatalf("an AUTHORED object read through %s was refused with %v; the wrapper "+
						"table answers where a value came from, and this one came from `.sm`", wrapped, got)
				}
			})
		}
	})
}

// constructorHost carries the same `@throws {never}` marker three ways: on its
// own line above a constructor, on the SAME LINE as one, and on the class.
const constructorHost = `/**
 * @module
 * @throws {never}
 */

export class OwnLineMarked {
  /** @throws {never} */
  constructor(readonly v: string) { if (v === "bad") throw new Error("own-line ctor blew"); }
}
export class SameLineMarked { /** @throws {never} */ constructor(readonly v: string) { if (v === "bad") throw new Error("same-line ctor blew"); } }
/** @throws {never} */
export class ClassMarkedOnly {
  constructor(readonly v: string) { if (v === "bad") throw new Error("class-marked ctor blew"); }
}
`

// TestPinnedForkTypeOnlyWrapperExactPositions pins, in one pass, the exact
// authored positions for the reported shapes, the trust asymmetry that makes
// `satisfies` and `as` the same for PROVENANCE and opposite for TRUST, the
// over-refusal this lane also closed, and where a constructor's trust claim may
// be read from.
//
// # On the trust asymmetry
//
// `as` and an explicit type annotation replace the declaration
// `GetResolvedSignature` resolves to with a `.sm`-local type node, which erases
// a `@throws {never}` marker. `satisfies` does not change the type at all, so
// the marker survives. If `satisfies` were ever implemented as "a cast that
// keeps the operand's type", the trusted-tag cases below are what would fail.
//
// # On the over-refusal
//
// `stableForeignCallee` asks whether a callee is a leaf read once at the point
// the call happens. A `@throws {never}` callee named through `satisfies` is
// exactly that, and this backend refused it SMITHERS1507 while the reference
// accepted it and RAN it — five cells of pure over-refusal plus fifteen more
// where the extra SMITHERS1507 rode alongside a correct diagnostic. This
// codebase has shipped seven over-corrections; an over-refusal is a defect, not
// a safe default. Every accepted case below asserts stdout, so the value is
// proven to have flowed rather than the program merely being un-refused.
//
// # On the constructor marker
//
// An earlier lane on this backend concluded the fork was right here and the
// reference wrong. It is the other way round, and the deciding fact is in
// TypeScript's own parser. A member's JSDoc comes from
// `parser.GetJSDocCommentRanges`, which for a class member is
// `scanner.GetLeadingCommentRanges` alone — and that iterator does not begin
// collecting until it has crossed a line break. So a `/** @throws {never} */`
// written on the SAME LINE as a constructor is trailing trivia of the token
// before it and is attached to NOTHING. Measured against this tree's vendored
// TypeScript 5.9.3, for `class SameLineMarked { /** @throws {never} */
// constructor(…) }`: `ctor.jsDoc` undefined, `getJSDocTags(ctor)` `[]`,
// `getLeadingCommentRanges(text, ctor.pos)` null — while the own-line twin
// yields `["throws"]`.
//
// The earlier probe used the same-line spelling, so there was no marker for the
// reference to honour and it was not ignoring a constructor marker at all. This
// backend read the block anyway, out of raw trivia text, and so believed a
// trust claim the checker attaches to nothing:
//
//	function make(): string { const o = new SameLineMarked("bad"); return "made" }
//
//	reference   SMITHERS1101@4:1 SMITHERS1504@4:37            — refused
//	this fork   ok, zero diagnostics → ran → Error: same-line ctor blew, exit 1
//
// So the fork was the fail-open. The claim now comes from the JSDoc the parser
// attaches to `GetResolvedSignature(new).Declaration()` and from nowhere else,
// which is the rule `foreignThrowsAnnotation`'s doc already states: a claim
// made about one declaration may not certify another.
func TestPinnedForkTypeOnlyWrapperExactPositions(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a satisfies over a foreign property read",
			support: wrapperForeign,
			source: "import { client } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [(client satisfies { readonly dangerous: string }).dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@4:11"},
		},
		{
			name:    "a satisfies over a foreign constructor",
			support: wrapperForeign,
			source: "import { Untrusted } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new (Untrusted satisfies new (v: string) => { readonly v: string })(\"a\")\n" +
				"  return [\"made\"]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@4:16"},
		},
		{
			name:    "a satisfies over a foreign tagged-template tag",
			support: wrapperForeign,
			source: "import { utag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [(utag satisfies (parts: TemplateStringsArray) => string)`x`]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1504@4:11"},
		},
		{
			name:    "a satisfies against a LOCAL alternate — the spelling a foreign alternate hides",
			support: wrapperForeign,
			source: "import { client } from \"./foreign.ts\"\n" +
				"\n" +
				"const localClient = { get dangerous(): string { return \"safe\" } }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [((client satisfies { readonly dangerous: string }) ?? localClient).dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@6:11"},
		},
		{
			name:    "a const that HOLDS the satisfies is the same defect",
			support: wrapperForeign,
			source: "import { client } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const held = client satisfies { readonly dangerous: string }\n" +
				"  return [held.dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@5:11"},
		},
		{
			name:    "a satisfies chained with a cast is the same defect",
			support: wrapperForeign,
			source: "import { client } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [((client satisfies { readonly dangerous: string }) as { readonly dangerous: string }).dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@4:11"},
		},
		{
			name:    "a foreign callable escaping through a satisfies in a higher-order call",
			support: wrapperForeign,
			source: "import { untrusted } from \"./foreign.ts\"\n" +
				"\n" +
				"function localHof(fn: (value: string) => string): string { return fn(\"x\") }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [localHof(untrusted satisfies (value: string) => string)]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@5:1", "SMITHERS1508@6:20"},
		},

		// --- the trust asymmetry -------------------------------------------
		{
			name:    "a trusted foreign tag stays usable through satisfies",
			support: wrapperForeign,
			source: "import { trustedTag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [(trustedTag satisfies (parts: TemplateStringsArray) => string)`x`]\n" +
				"}\n",
			stdout: "t",
		},
		{
			name:    "an as over the same trusted tag ERASES the marker and is refused",
			support: wrapperForeign,
			source: "import { trustedTag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [(trustedTag as (parts: TemplateStringsArray) => string)`x`]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1504@4:11"},
		},
		{
			name:    "an annotated const holding the same trusted tag ERASES the marker too",
			support: wrapperForeign,
			source: "import { trustedTag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const held: (parts: TemplateStringsArray) => string = trustedTag\n" +
				"  return [held`x`]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1504@5:11"},
		},
		{
			name:    "satisfies THEN as composes to the as answer, which is the fail-closed one",
			support: wrapperForeign,
			source: "import { trustedTag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [((trustedTag satisfies (parts: TemplateStringsArray) => string) as (parts: TemplateStringsArray) => string)`x`]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1504@4:11"},
		},

		// --- the over-refusal, closed --------------------------------------
		{
			name:    "a trusted foreign callee named through satisfies stays usable and RUNS",
			support: wrapperForeign,
			source: "import { trustedFn } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const a = (trustedFn satisfies (value: string) => string)(\"a\")\n" +
				"  const b = (trustedFn satisfies unknown as (value: string) => string)(\"b\")\n" +
				"  const c = (((trustedFn) satisfies (value: string) => string))(\"c\")\n" +
				"  return [a + b + c]\n" +
				"}\n",
			stdout: "ABC",
		},
		{
			name: "an authored call, an authored new, an as const and an annotated const through satisfies",
			source: "const box = { p: \"a\" }\n" +
				"function localCall(value: string): string { return value }\n" +
				"class LocalCtor { constructor(readonly v: string) {} }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const one = (box satisfies { readonly p: string }).p\n" +
				"  const two = ([box] as const)[0].p\n" +
				"  const three: { readonly p: string } = box\n" +
				"  const four = (localCall satisfies (v: string) => string)(\"c\")\n" +
				"  const five = new (LocalCtor satisfies new (v: string) => { readonly v: string })(\"d\")\n" +
				"  box satisfies { readonly p: string }\n" +
				"  return [one + two + three.p + four + five.v]\n" +
				"}\n",
			stdout: "aaacd",
		},

		// --- where a constructor's trust claim may be read from -------------
		{
			name:    "a marker on its OWN LINE is attached, honoured, and the program runs",
			support: constructorHost,
			source: "import { OwnLineMarked } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new OwnLineMarked(\"a\")\n" +
				"  return [\"made\"]\n" +
				"}\n",
			stdout: "made",
		},
		{
			name:    "a marker on the SAME LINE is attached to nothing and must not be believed",
			support: constructorHost,
			source: "import { SameLineMarked } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new SameLineMarked(\"a\")\n" +
				"  return [\"made\"]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@4:16"},
		},
		{
			name:    "a marker on the CLASS does not certify its constructor",
			support: constructorHost,
			source: "import { ClassMarkedOnly } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new ClassMarkedOnly(\"a\")\n" +
				"  return [\"made\"]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@4:16"},
		},
		{
			name:    "the same-line marker is not rescued by a satisfies either",
			support: constructorHost,
			source: "import { SameLineMarked } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new (SameLineMarked satisfies new (v: string) => { readonly v: string })(\"a\")\n" +
				"  return [\"made\"]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@4:16"},
		},
		{
			name:    "an own-line marker is still honoured through a satisfies, and still runs",
			support: constructorHost,
			source: "import { OwnLineMarked } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new (OwnLineMarked satisfies new (v: string) => { readonly v: string })(\"a\")\n" +
				"  return [\"made\"]\n" +
				"}\n",
			stdout: "made",
		},
	})
}
