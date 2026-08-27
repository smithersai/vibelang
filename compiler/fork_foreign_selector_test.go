package compiler

import (
	"context"
	"sort"
	"strings"
	"testing"
)

// The foreign boundary, on the Go fork, when a SELECTING operator stands
// between the program and the foreign value.
//
// `foreignValueProvenance` — the walk that answers "did this value come out of
// a TypeScript module?" — knew the parenthesis, the cast, the property access,
// the element access, the call, the `new` and the const initializer, and knew
// none of `??`, `||`, `&&`, the ternary, the comma or the assignment. Its
// SIBLING walk (`contextReceiverOf`, which answers which capability a
// `.context()` receiver names) carried the complete table the whole time, under
// the name `receiverBranches`. Two walks, two copies, one of them incomplete.
//
// The consequence, measured on both backends before the fix:
//
//	new (Untrusted ?? Other)("a")        accepted, `failures: []`, threw at run time
//	(client ?? otherClient).dangerous    accepted, `failures: []`, threw at run time
//	(utag ?? otherTag)`x`                accepted, `failures: []`, threw at run time
//
// while `new Untrusted("a")`, `client.dangerous` and `` utag`x` `` were each
// refused. SMITHERS1504, SMITHERS1506 and SMITHERS1508 were escapable by typing
// two characters, and a raw host `Error` left a function whose row said it could
// not fail.
//
// The fix is that the table is now ONE function — `valueBranches` in
// lowering.go — CALLED by both walks. It is deliberately not a second copy
// taught the missing operators: a copy is how this defect was introduced, and a
// third copy is how the next one would be. The tests below are written the same
// way. The refusal half asserts that every selecting spelling answers EXACTLY
// what the direct spelling answers, rather than hard-coding a code list per
// spelling, so a rule that later changes its answer changes it for all of them
// or fails here.
//
// The negative half is the load-bearing half: `??` over two locals, over two
// trusted foreign values, an ordinary `new` on an authored class and an ordinary
// property read on an authored object must all still compile AND RUN.
//
// Mirrors the reference's `valueBranches` and
// poc/src/language/foreign-implicit-invocation.test.ts.

// selectorForeign is the untrusted module every refusal below reaches. Only the
// module-initialization header claims `@throws {never}`; no export does.
const selectorForeign = `/**
 * @module
 * @throws {never}
 */

export class Untrusted { constructor(readonly v: string) { throw new Error("ctor"); } }
export class Other { constructor(readonly v: string) {} }

export const client = { get dangerous(): string { throw new Error("getter"); } };
export const otherClient = { get dangerous(): string { return "safe"; } };

export function utag(parts: TemplateStringsArray): string { throw new Error("tag"); }
export function otherTag(parts: TemplateStringsArray): string { return "x"; }

export const iterable: Iterable<string> = {
  [Symbol.iterator](): Iterator<string> { throw new Error("iterator"); },
};
export const otherIterable: Iterable<string> = {
  [Symbol.iterator](): Iterator<string> { throw new Error("iterator"); },
};

export function untrusted(value: string): string { throw new Error("call"); }
export function other(value: string): string { return value; }

/** @throws {never} */
export function trustedTag(parts: TemplateStringsArray): string { return "t"; }
/** @throws {never} */
export function trustedTag2(parts: TemplateStringsArray): string { return "t2"; }
`

// foreignSelectors are the spellings whose runtime value can be the foreign
// operand. `%s` is the foreign value, `%[2]s` its alternate. Every one of them
// must reach the same verdict as "direct", because every one of them can
// evaluate to the same value.
var foreignSelectors = []struct {
	name     string
	spelling func(foreign, alternate string) string
}{
	{"direct", func(f, _ string) string { return f }},
	{"parenthesised", func(f, _ string) string { return "(" + f + ")" }},
	{"nullish, foreign on the left", func(f, a string) string { return "(" + f + " ?? " + a + ")" }},
	{"nullish, foreign on the right", func(f, a string) string { return "(" + a + " ?? " + f + ")" }},
	{"logical or", func(f, a string) string { return "(" + f + " || " + a + ")" }},
	{"logical and", func(f, a string) string { return "(" + a + " && " + f + ")" }},
	{"ternary, foreign in the true arm", func(f, a string) string { return "(flag ? " + f + " : " + a + ")" }},
	{"ternary, foreign in the false arm", func(f, a string) string { return "(flag ? " + a + " : " + f + ")" }},
	{"comma", func(f, a string) string { return "(" + a + ", " + f + ")" }},
	{"nested nullish", func(f, a string) string { return "((" + f + " ?? " + a + ") ?? " + a + ")" }},
	{"nullish over an or", func(f, a string) string { return "(" + f + " ?? (" + a + " || " + a + "))" }},
	{"ternary inside a nullish", func(f, a string) string { return "((flag ? " + f + " : " + a + ") ?? " + a + ")" }},
	{"parenthesised nullish", func(f, a string) string { return "((" + f + " ?? " + a + "))" }},
}

// foreignSelectorPositions are the USE positions. Each renders a whole `.sm`
// module around a selected value; the rule that governs the position is named
// so a failure says which one moved.
var foreignSelectorPositions = []struct {
	name      string
	imports   string
	foreign   string
	alternate string
	// body renders the statements of `main`, given the selected expression.
	body func(selected string) string
	// governs is the code the DIRECT spelling must already report, asserted so
	// an accidentally-clean baseline cannot make the equality vacuous.
	governs string
}{
	{
		name: "a foreign constructor", imports: "Untrusted, Other", foreign: "Untrusted", alternate: "Other",
		body:    func(s string) string { return "  const made = new " + s + "(\"a\")\n  return [made.v]\n" },
		governs: "SMITHERS1504",
	},
	{
		name: "a foreign property read", imports: "client, otherClient", foreign: "client", alternate: "otherClient",
		body:    func(s string) string { return "  return [" + s + ".dangerous]\n" },
		governs: "SMITHERS1506",
	},
	{
		name: "a foreign element-access read", imports: "client, otherClient", foreign: "client", alternate: "otherClient",
		body:    func(s string) string { return "  return [" + s + "[\"dangerous\"]]\n" },
		governs: "SMITHERS1506",
	},
	{
		name: "a foreign tagged-template tag", imports: "utag, otherTag", foreign: "utag", alternate: "otherTag",
		body:    func(s string) string { return "  return [" + s + "`x`]\n" },
		governs: "SMITHERS1504",
	},
	{
		name: "a foreign iterable spread", imports: "iterable, otherIterable", foreign: "iterable", alternate: "otherIterable",
		body:    func(s string) string { return "  return [..." + s + "]\n" },
		governs: "SMITHERS1506",
	},
	{
		name: "a foreign iterable in for…of", imports: "iterable, otherIterable", foreign: "iterable", alternate: "otherIterable",
		body: func(s string) string {
			return "  const out: string[] = []\n  for (const part of " + s + ") out.push(part)\n  return out\n"
		},
		governs: "SMITHERS1506",
	},
	{
		name: "a foreign callable handed to a local higher-order call", imports: "untrusted, other", foreign: "untrusted", alternate: "other",
		body:    func(s string) string { return "  return [localHof(" + s + ")]\n" },
		governs: "SMITHERS1508",
	},
	{
		name: "a foreign callable stored through a mutable alias", imports: "untrusted, other", foreign: "untrusted", alternate: "other",
		body:    func(s string) string { return "  let held = " + s + "\n  return [typeof held]\n" },
		governs: "SMITHERS1508",
	},
}

func selectorModule(imports, body string) string {
	return "import { " + imports + " } from \"./foreign.ts\"\n" +
		"\n" +
		"function localHof(fn: (value: string) => string): string { return fn(\"x\") }\n" +
		"\n" +
		"export function main(flag: boolean = true): string[] {\n" +
		body +
		"}\n"
}

// diagnosticCodes compiles one module and returns its distinct diagnostic codes.
// Codes and not positions: a selecting spelling necessarily moves the column, so
// only the codes can be compared across spellings.
func diagnosticCodes(t *testing.T, backend Compiler, ctx context.Context, source, support string) []string {
	t.Helper()
	files := []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: source},
		{Path: "foreign.ts", Kind: FileKindTypeScript, Text: support},
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm", "foreign.ts"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for _, position := range formatDiagnosticPositions(t, files, result) {
		code, _, _ := strings.Cut(position, "@")
		seen[code] = true
	}
	codes := make([]string, 0, len(seen))
	for code := range seen {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes
}

// TestPinnedForkSelectedForeignValueAnswersLikeTheDirectSpelling is the ONE
// TABLE assertion. It is written as an equality against the direct spelling
// rather than as a per-spelling code list on purpose: the property being pinned
// is that the selecting operators carry provenance, not that they happen to
// report SMITHERS1504 today.
func TestPinnedForkSelectedForeignValueAnswersLikeTheDirectSpelling(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, position := range foreignSelectorPositions {
		t.Run(position.name, func(t *testing.T) {
			direct := diagnosticCodes(t, backend, ctx,
				selectorModule(position.imports, position.body(position.foreign)), selectorForeign)
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
			for _, selector := range foreignSelectors {
				if selector.name == "direct" {
					continue
				}
				t.Run(selector.name, func(t *testing.T) {
					selected := selector.spelling(position.foreign, position.alternate)
					got := diagnosticCodes(t, backend, ctx,
						selectorModule(position.imports, position.body(selected)), selectorForeign)
					if strings.Join(got, " ") != strings.Join(direct, " ") {
						t.Fatalf("%s answers %v; the direct spelling answers %v — a selecting "+
							"operator carries the provenance of the operand it yields, so the two "+
							"must be the same set", selected, got, direct)
					}
				})
			}
		})
	}
}

// TestPinnedForkSelectedForeignValuePositions pins the exact authored positions
// for the three shapes the defect was reported against, so a regression that
// merely moves the diagnostic somewhere else still fails.
func TestPinnedForkSelectedForeignValuePositions(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a nullish-selected foreign constructor",
			support: selectorForeign,
			source: "import { Untrusted, Other } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const made = new (Untrusted ?? Other)(\"a\")\n" +
				"  return [made.v]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@4:16", "SMITHERS1506@5:11"},
		},
		{
			name:    "a nullish-selected foreign property read",
			support: selectorForeign,
			source: "import { client, otherClient } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [(client ?? otherClient).dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@4:11"},
		},
		{
			name:    "a nullish-selected foreign tagged-template tag",
			support: selectorForeign,
			source: "import { utag, otherTag } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [(utag ?? otherTag)`x`]\n" +
				"}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1504@4:11"},
		},
		{
			name:    "a ternary-selected foreign constructor is the same defect",
			support: selectorForeign,
			source: "import { Untrusted, Other } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(flag: boolean = true): string[] {\n" +
				"  const made = new (flag ? Untrusted : Other)(\"a\")\n" +
				"  return [made.v]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@4:16", "SMITHERS1506@5:11"},
		},
		{
			name:    "a const that HOLDS the selection is the same defect",
			support: selectorForeign,
			source: "import { client, otherClient } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const held = client ?? otherClient\n" +
				"  return [held.dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@5:11"},
		},
		{
			name:    "a cast over the selection is the same defect",
			support: selectorForeign,
			source: "import { client, otherClient } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [((client ?? otherClient) as { readonly dangerous: string }).dangerous]\n" +
				"}\n",
			reject: []string{"SMITHERS1506@4:11"},
		},
	})
}

// TestPinnedForkSelectingOperatorsStayUsable is the other direction, and it is
// why the fix folds branches instead of refusing every selecting operator
// outright. Each program below is legitimate, must compile, and must RUN — the
// stdout assertion is what proves the value really flowed, rather than the
// program merely being un-refused.
func TestPinnedForkSelectingOperatorsStayUsable(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "nullish, or, and and a ternary over two LOCAL values",
			source: "export function main(): string[] {\n" +
				"  const missing: string | undefined = undefined\n" +
				"  const present = \"b\"\n" +
				"  return [(missing ?? present) + (missing || present) + (present && present) + (true ? present : present)]\n" +
				"}\n",
			stdout: "bbbb",
		},
		{
			name: "an ordinary new on an AUTHORED class, through every selecting operator",
			source: "class Box { constructor(readonly v: string) {} }\n" +
				"class Bin { constructor(readonly v: string) {} }\n" +
				"\n" +
				"export function main(flag: boolean = true): string[] {\n" +
				"  return [\n" +
				"    new Box(\"a\").v,\n" +
				"    new (Box ?? Bin)(\"b\").v,\n" +
				"    new (Box || Bin)(\"c\").v,\n" +
				"    new (flag ? Box : Bin)(\"d\").v,\n" +
				"    new ((Box ?? Bin) ?? Bin)(\"e\").v,\n" +
				"  ]\n" +
				"}\n",
			stdout: "a\nb\nc\nd\ne",
		},
		{
			name: "an ordinary property read on an AUTHORED object, through every selecting operator",
			source: "const first = { label: \"a\" }\n" +
				"const second = { label: \"b\" }\n" +
				"\n" +
				"export function main(flag: boolean = true): string[] {\n" +
				"  return [\n" +
				"    first.label,\n" +
				"    (first ?? second).label,\n" +
				"    (first || second).label,\n" +
				"    (flag ? first : second).label,\n" +
				"    ((first ?? second) ?? second).label,\n" +
				"  ]\n" +
				"}\n",
			stdout: "a\na\na\na\na",
		},
		{
			// The trust marker survives the selection: a `@throws {never}` tag
			// selected at runtime between two `@throws {never}` tags is still a
			// trusted tag, and the fold must not refuse it. This is the case a
			// blanket "any selecting operator is foreign" rule would break.
			name:    "a nullish over two TRUSTED foreign tags stays usable",
			support: selectorForeign,
			source: "import { trustedTag, trustedTag2 } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(flag: boolean = true): string[] {\n" +
				"  return [\n" +
				"    trustedTag`x`,\n" +
				"    (trustedTag ?? trustedTag2)`x`,\n" +
				"    (trustedTag || trustedTag2)`x`,\n" +
				"    (flag ? trustedTag : trustedTag2)`x`,\n" +
				"  ]\n" +
				"}\n",
			stdout: "t\nt\nt\nt",
		},
		{
			// A capability receiver reached through the SAME table. This is the
			// walk that always had it, kept here so that renaming the table into
			// a shared one cannot quietly change the answer it gave before.
			name: "a capability receiver selected between two spellings of ONE capability still resolves",
			source: "import { Context } from \"smthrs/context\"\n" +
				"import { Layer } from \"smthrs/provider\"\n" +
				"\n" +
				"abstract class Db extends Context {\n" +
				"  abstract read(): string\n" +
				"}\n" +
				"\n" +
				"const db: Db = { read: () => \"DB\" }\n" +
				"\n" +
				"export function main(flag: boolean = true): string[] {\n" +
				"  const app = Layer.succeed(Db, db)\n" +
				"  const out: string[] = []\n" +
				"  Layer.provide(app, () => { out.push((flag ? Db : Db).context().read()) })\n" +
				"  return out\n" +
				"}\n",
			stdout: "DB",
		},
	})
}
