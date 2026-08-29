package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

// Flow-output projection: the durable lowerer's `project` builds Plan IR by
// appending a path component to an `input` or `node` expression, and until the
// check these tests pin, nothing anywhere validated that component against the
// durable descriptor the value actually carries.
//
// The consequence was not theoretical. `return { count: input.items.length }`
// lowered to `{"kind":"input","path":["items","length"]}`, compiled with zero
// diagnostics, emitted, and RAN — while the reference frontend refused the same
// program with SMITHERS4110. `.length` is the sharpest spelling of the hole:
// TypeScript accepts it on an array so no stock diagnostic fires, the durable
// input descriptor has no such field, and the engine's `pathValue` refuses a
// non-numeric part on an array with a runtime ProjectionDefect.
//
// Every message and position asserted here was measured against the JS
// reference backend on the same source text, so the two implementations answer
// one code, one position and one sentence.

const durableProjectionPreamble = "import { durable, Action, sleep, sequential, waitSignal } from \"smithers:flows\"\n"

// durableProjectionAnchor is the position both backends report at: the durable
// source function itself, not the projection. The reference reports from
// `flowSchemas`, whose diagnostic node is `sourceFunction`; this bridge reports
// from `checkFlowOutput` against the node `resolveDurableFunction` returned.
func durableProjectionAnchor(t *testing.T, source string) int {
	t.Helper()
	offset := strings.Index(source, "((input")
	if offset < 0 {
		t.Fatalf("source does not open a durable arrow function:\n%s", source)
	}
	return offset + 1
}

func requireSoleDurableRefusal(t *testing.T, result CompileResult, source string, message string) {
	t.Helper()
	if !result.EmitSkipped {
		t.Fatalf("a Flow-output projection defect must refuse the program, not weaken its contract")
	}
	if len(result.Diagnostics) != 1 {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("want exactly one diagnostic, got %s", encoded)
	}
	item := result.Diagnostics[0]
	want := "durable Flow boundary is not structurally encodable: " + message
	if item.Code != "SMITHERS4110" || item.Message != want || item.File != "main.sm" || item.Phase != PhaseLower {
		t.Fatalf("diagnostic = %#v, want SMITHERS4110 %q at main.sm during lowering", item, want)
	}
	anchor := durableProjectionAnchor(t, source)
	if item.Span == nil || item.Span.Start != anchor {
		t.Fatalf("diagnostic span = %#v, want start %d (the durable source function)", item.Span, anchor)
	}
}

// TestPinnedForkDurableRefusesAFlowOutputProjectionItsDescriptorCannotAnswer
// crosses the projection spellings against every container the walk recurses
// through. Each program compiled clean AND ran before the check existed.
func TestPinnedForkDurableRefusesAFlowOutputProjectionItsDescriptorCannotAnswer(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name    string
		body    string
		message string
	}{
		{
			// THE ORACLE. One Action, so the Flow's success schema stays this
			// bridge's legacy stub and the return expression's TypeScript type
			// is never derived — the exact shape that used to compile and run.
			name: "input array beside an Action success",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string; items: readonly string[] }) => {
  const found = Step.run({ key: input.key })!
  return { value: found.value, count: input.items.length }
})`,
			message: "Flow output cannot project length from durable array",
		},
		{
			// The same defect with no Action anywhere. The success schema IS
			// derived here, structurally, from `{ count: number }` — which is
			// derivable, so that derivation never noticed the bad path.
			name: "input array with no Action at all",
			body: `export const Flow = durable((input: { items: readonly string[] }) => {
  return { count: input.items.length }
})`,
			message: "Flow output cannot project length from durable array",
		},
		{
			name: "input string",
			body: `export const Flow = durable((input: { name: string }) => {
  return { size: input.name.length }
})`,
			message: "Flow output cannot project length from durable string",
		},
		{
			// TypeScript types `pair.length` as the literal `2`, so the return
			// type stays derivable and nothing else objected.
			name: "input tuple, non-numeric key",
			body: `export const Flow = durable((input: { pair: readonly [string, number] }) => {
  return { n: input.pair.length }
})`,
			message: "Flow output cannot project length from durable tuple",
		},
		{
			// `.length` is legal TypeScript on BOTH legs of the union, so the
			// projection reaches the Plan and both legs refuse it.
			name: "input union of string and array",
			body: `export const Flow = durable((input: { value: string | readonly string[] }) => {
  return { n: input.value.length }
})`,
			message: "Flow output cannot project length from durable array",
		},
		{
			name: "input object field the descriptor lacks, behind an Action",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string; pair: readonly [string, number] }) => {
  const found = Step.run({ key: input.key })!
  return { value: found.value, a: input.pair[5] }
})`,
			message: "Flow output projects missing durable tuple index 5",
		},
		{
			name: "input number member, behind an Action",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string; n: number }) => {
  const found = Step.run({ key: input.key })!
  return { value: found.value, t: input.n.toFixed }
})`,
			message: "Flow output cannot project toFixed from durable number",
		},
		{
			name: "Action success array",
			body: `class Step extends Action<(input: { key: string }) => Result<{ rows: readonly string[] }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const found = Step.run({ key: input.key })!
  return { count: found.rows.length }
})`,
			message: "Flow output cannot project length from durable array",
		},
		{
			name: "Action success string field",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const found = Step.run({ key: input.key })!
  return { size: found.value.length }
})`,
			message: "Flow output cannot project length from durable string",
		},
		{
			name: "Action whose success is itself a scalar",
			body: `class Step extends Action<(input: { key: string }) => Result<string, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const found = Step.run({ key: input.key })!
  return { size: found.length }
})`,
			message: "Flow output cannot project length from durable string",
		},
		{
			name: "signal payload string",
			body: `export const Flow = durable((input: { k: string }) => {
  const approval = waitSignal<string>("build.approval")
  return { n: approval.length, k: input.k }
})`,
			message: "Flow output cannot project length from durable string",
		},
		{
			name: "signal payload array",
			body: `export const Flow = durable((input: { k: string }) => {
  const rows = waitSignal<readonly string[]>("build.rows")
  return { n: rows.length, k: input.k }
})`,
			message: "Flow output cannot project length from durable array",
		},
		{
			name: "sequential pair member",
			body: `class A extends Action<(input: { k: string }) => Result<{ rows: readonly string[] }, Error>> {}
class B extends Action<(input: { k: string }) => Result<{ w: string }, Error>> {}
export const Flow = durable((input: { k: string }) => {
  const pair = sequential(A.run({ k: input.k }), B.run({ k: input.k }))
  return { n: pair[0].rows.length }
})`,
			message: "Flow output cannot project length from durable array",
		},
		{
			// A defect inside ONE branch arm. The other arm is sound, and the
			// branch is what the walk merges through.
			name: "branch arm",
			body: `export const Flow = durable((input: { flag: boolean; items: readonly string[]; b: number }) => {
  const chosen = input.flag ? { v: input.items.length } : { v: input.b }
  return { v: chosen.v }
})`,
			message: "Flow output cannot project length from durable array",
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [Flow.artifactSource] }
`
			requireSoleDurableRefusal(t, compileDurableWith(t, backend, ctx, source), source, probe.message)
		})
	}
}

// TestPinnedForkDurableFlowOutputProjectionCheckKeepsSoundProgramsCompiling is
// the over-correction direction, and it is the half of this change that a
// narrowing rule most easily breaks. Every program here reads a path its own
// descriptors CAN answer, through the same containers the refusals above walk.
func TestPinnedForkDurableFlowOutputProjectionCheckKeepsSoundProgramsCompiling(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name string
		body string
	}{
		{
			name: "input object field",
			body: `export const Flow = durable((input: { key: string }) => {
  return { key: input.key }
})`,
		},
		{
			name: "numeric index into an input array",
			body: `export const Flow = durable((input: { items: readonly string[] }) => {
  return { first: input.items[0] }
})`,
		},
		{
			name: "numeric index into an input tuple",
			body: `export const Flow = durable((input: { pair: readonly [string, number] }) => {
  return { a: input.pair[0] }
})`,
		},
		{
			name: "nested input object path",
			body: `export const Flow = durable((input: { outer: { inner: string } }) => {
  return { v: input.outer.inner }
})`,
		},
		{
			name: "Action success field",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const found = Step.run({ key: input.key })!
  return { value: found.value }
})`,
		},
		{
			name: "field both branch arms carry",
			body: `export const Flow = durable((input: { flag: boolean; a: string; b: string }) => {
  const chosen = input.flag ? { v: input.a } : { v: input.b }
  return { v: chosen.v }
})`,
		},
		{
			name: "field both branch arms' Actions carry",
			body: `class Left extends Action<(input: { k: string }) => Result<{ v: string; only: string }, Error>> {}
class Right extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
export const Flow = durable((input: { flag: boolean; k: string }) => {
  return { v: (input.flag ? Left.run({ k: input.k })! : Right.run({ k: input.k })!).v }
})`,
		},
		{
			// A timer node carries no value at all. It must reach the output
			// with an empty path without manufacturing a projection failure.
			name: "timer node in the output",
			body: `class Step extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
export const Flow = durable((input: { k: string }) => {
  const found = Step.run({ k: input.k })!
  const t = sleep(5)
  return { v: found.v, t }
})`,
		},
		{
			name: "signal payload field",
			body: `export const Flow = durable((input: { k: string }) => {
  const approval = waitSignal<{ ok: boolean }>("build.approval")
  return { ok: approval.ok, k: input.k }
})`,
		},
		{
			name: "both members of a sequential pair",
			body: `class A extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
class B extends Action<(input: { k: string }) => Result<{ w: string }, Error>> {}
export const Flow = durable((input: { k: string }) => {
  const pair = sequential(A.run({ k: input.k }), B.run({ k: input.k }))
  return { v: pair[0].v, w: pair[1].w }
})`,
		},
		{
			name: "literal-only output",
			body: `export const Flow = durable((input: { k: string }) => {
  return { fixed: "constant", n: 7, ok: true, nothing: null }
})`,
		},
		{
			name: "index into an array literal",
			body: `export const Flow = durable((input: { a: string; b: string }) => {
  const items = [input.a, input.b]
  return { first: items[0] }
})`,
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [Flow.artifactSource] }
`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				encoded, _ := json.Marshal(result.Diagnostics)
				t.Fatalf("a sound projection must still compile: emitSkipped=%v %s", result.EmitSkipped, encoded)
			}
			if got := runComptimeProgram(t, result); got != "static-plan-artifact" {
				t.Fatalf("emitted Flow did not run to a static Plan descriptor: %q", got)
			}
		})
	}
}

// TestPinnedForkDurableFlowOutputProjectionDerivesTheSuccessSchema is the
// second half of the over-correction direction and the stronger half: not
// merely "it still compiles" but "it compiles to exactly the bytes the
// reference compiles it to".
//
// WHAT THIS TEST USED TO SAY, AND WHY THAT PREMISE IS GONE. It was
// `...CheckLeavesPlanDigestsByteIdentical`, and its digests were measured
// against a bridge built BEFORE the projection walk existed, to prove the walk
// derived a descriptor only to discard it. That was true and worth pinning
// while `plan()` emitted `durableLegacySchema("success")` for every Flow using
// an Action — and it was also, exactly, the defect: a stub where the reference
// emits a structural schema was the sole structural difference between the two
// backends' Plans, and the reason `plan.digest` diverged on every comparable
// program. The walk now feeds `d.successSchema`, so "unchanged from before the
// walk" is no longer a property this bridge should have.
//
// So the pin is re-aimed rather than deleted, at a strictly stronger claim.
// Every `digest` below was regenerated on 2026-08-28 by RUNNING BOTH BACKENDS
// over that exact program — `poc/src/durable/source-compiler.ts` through
// `compileDurableSource`, and this bridge through `cmd/smithersc-go` — and the
// two agreed byte-for-byte on the whole Plan, not only on the digest. A value
// here is therefore cross-backend agreement, which is what a Plan digest has to
// be before a Manifest digest can be a signature; it is not a historical
// snapshot of one implementation. `shape` is pinned beside it because a silent
// return to the stub would keep the test honest only if the digest moved, and
// naming the shape says which of the two answers is expected.
func TestPinnedForkDurableFlowOutputProjectionDerivesTheSuccessSchema(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name   string
		flow   string
		body   string
		shape  string
		digest string
	}{
		{
			name: "one Action",
			flow: "Flow",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const found = Step.run({ key: input.key })!
  return { value: found.value }
})`,
			shape:  "structural",
			digest: "a4512066af51b6f2b7b8f77fdda7291da6f54d1866ed2a8e1bb26943ab0b5009",
		},
		{
			name: "branch join over two Actions",
			flow: "Flow",
			body: `class Left extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
class Right extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
export const Flow = durable((input: { flag: boolean; k: string }) => {
  return { v: (input.flag ? Left.run({ k: input.k })! : Right.run({ k: input.k })!).v }
})`,
			shape:  "structural",
			digest: "92fb943a8ffe695eee398eed80260d99447f370629264203250cff19370c2532",
		},
		{
			// The reference asserted this direction with a `fanOut` and a
			// `loopWhile` leg. This subset refuses both wholesale (SMITHERS4117,
			// SMITHERS4121), so the two multi-Action shapes it DOES accept stand
			// in for them: a `sequential` pair and the timer/signal Flow.
			name: "sequential pair",
			flow: "Flow",
			body: `class A extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
class B extends Action<(input: { k: string }) => Result<{ w: string }, Error>> {}
export const Flow = durable((input: { k: string }) => {
  const pair = sequential(A.run({ k: input.k }), B.run({ k: input.k }))
  return { v: pair[0].v, w: pair[1].w }
})`,
			shape:  "structural",
			digest: "57f8a2a262aabf1b3bd8417c20a014bc879092e3fc36c0c4ed8130ca237efcda",
		},
		{
			name: "Action, branch, timer, sequential and signal together",
			flow: "Build",
			body: `class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Audit extends Action<(input: { value: string }) => Result<{ saved: boolean }, Error>> {}
export const Build = durable((input: { key: string; live: boolean }) => {
  const found = Lookup.run({ key: input.key })!
  const selected = input.live ? found.value : "offline"
  sleep(25)
  const pair = sequential(Lookup.run({ key: selected }), Audit.run({ value: selected }))
  const approval = waitSignal<string>("build.approval")
  return { approval, pair, selected }
})`,
			shape:  "structural",
			digest: "a67b44af011b31dab88d21530542a582951b42ee735e665aa5a32d1b29425021",
		},
		{
			// The Action-free control, and the one row whose digest did NOT
			// move: its success schema was already structural, because the
			// widened TypeScript type of `{ key: input.key }` and the walk's
			// descriptor of the same expression happen to agree here. They do
			// not always — `return { ok: true }` types as `{ ok: boolean }` and
			// walks to `{kind:"literal",value:true}` — which is why the
			// TypeScript-type derivation was replaced rather than kept for the
			// Action-free case.
			name: "no Action, structural success schema",
			flow: "Flow",
			body: `export const Flow = durable((input: { key: string }) => {
  return { key: input.key }
})`,
			shape:  "structural",
			digest: "e5c02f89c98de1b4a345215754153bdfc9c24fe103b76803c12a10e180b379ad",
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [` + probe.flow + `.artifactSource, ` +
				probe.flow + `.plan.flowSchemas.success.shape, ` + probe.flow + `.plan.digest] }
`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				encoded, _ := json.Marshal(result.Diagnostics)
				t.Fatalf("a derivable Flow boundary must survive: emitSkipped=%v %s", result.EmitSkipped, encoded)
			}
			want := "static-plan-artifact," + probe.shape + "," + probe.digest
			if got := runComptimeProgram(t, result); got != want {
				t.Fatalf("Plan no longer matches the reference:\n got %q\nwant %q", got, want)
			}
		})
	}
}

// TestPinnedForkDurableFlowOutputProjectionReportsOneDeterministicSentence is
// the fork-shaped half of the traversal-order lesson the reference frontend
// learned, and it is a HARDER problem here than there.
//
// The reference's mask was semantic: with first-failure-wins, `Object.keys`
// ordering let a legitimately weak legacy leg throw before a sibling defect and
// the catch swallowed it. This bridge has no weak leg to be masked by — every
// Action success schema it lowers is structural by construction — but it has a
// worse ordering hazard, because a Plan output object's fields live in a Go
// `map`, whose iteration order is deliberately RANDOMIZED. A walk in map order
// reports a different sentence on different runs of the same compiler over the
// same source, which is a flaky diagnostic rather than a masked one.
//
// Measured, not assumed: with `sortUTF16` removed from the object walk, a
// two-field version of this program reported "from durable array" 7 times and
// "from durable string" 3 times in 10 runs of one binary. All three fields'
// defects ARE recorded — the walk continues past the first — and sorting is what
// decides which one is named. The reference's `Object.keys(...).sort()` chooses
// the same one.
//
// Three fields with three DISTINCT sentences and many attempts, deliberately:
// a mutation that removes the sort has a 1-in-3 chance of looking right on any
// one compile, so a test with one attempt would be a coin toss rather than a
// gate.
//
// The field names STRADDLE THE SURROGATE BOUNDARY, and that is the second thing
// this test measures. It named its fields `a`, `m`, and `x` until 2026-08-28,
// which pinned "the walk is sorted" but could not tell a UTF-16 sort from a
// UTF-8 byte sort, because the two orders coincide on ASCII. That is precisely
// the hazard that shipped: the sibling descriptor walk in
// `durableTypeDescriptor` used Go's native `<` and minted a different Action
// contract digest from the reference for any Action whose field names crossed
// U+FFFF, with no diagnostic from either backend. This test sat next to it
// "measuring" the same hazard and could not go red.
//
//	name        UTF-16 unit   UTF-8 first byte
//	"\u{1F600}a"  D83D (pair)  F0
//	"\uFF58x"     FF58         EF
//	"\uFFFDm"     FFFD         EF
//
// So UTF-16 order is [emoji, fullwidth-x, replacement-char] and UTF-8 byte order
// is [fullwidth-x, replacement-char, emoji]. The two rules therefore name
// DIFFERENT sentences from the same program: "durable array" under UTF-16,
// "durable tuple" under bytes. A regression to `sort.Strings` here fails on
// every attempt rather than one in three.
func TestPinnedForkDurableFlowOutputProjectionReportsOneDeterministicSentence(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := durableProjectionPreamble + `
export const Flow = durable((input: {
  alpha: readonly string[]
  mike: string
  xray: readonly [string, number]
}) => {
  return {
    "\u{1F600}a": input.alpha.length,
    "\uFFFDm": input.mike.length,
    "\uFF58x": input.xray.length
  }
})
export function main(): string[] { return [Flow.artifactSource] }
`
	// The emoji-led name sorts first in UTF-16 code units, so the array defect is
	// the one both backends name; the other two would read "durable string" and
	// "durable tuple". Under Go's byte order the fullwidth-x name would sort
	// first and this would read "durable tuple" instead.
	const want = "Flow output cannot project length from durable array"
	for attempt := 0; attempt < 24; attempt++ {
		requireSoleDurableRefusal(t, compileDurableWith(t, backend, ctx, source), source, want)
	}
}

// TestPinnedForkDurableFlowOutputProjectionKeepsThePlaceholderOutOfCanonicalJSON
// pins the invariant that lets the placeholder be a distinct Go type rather than
// a real-looking descriptor: it never nests inside a composite and never reaches
// `durableCanonicalJSON`.
//
// This is the guard the reference reported as UNVERIFIED on its side — it could
// build no program where dropping its `joinDescriptors` unknown-leg check
// changed an outcome, because its placeholder serializes exactly like a real
// `null` descriptor and `canonicalUnion` happened to preserve object identity
// through its dedupe map. Here the same two programs are decisive. Measured:
// removing the `durableJoinDescriptors` guard, or the object-descriptor
// poisoning, turns each of these into
// `panic: unsupported durable canonical JSON value main.durableUnknownDescriptor`
// — reported by the harness as a backend failure with no authored position at
// all, not as the refusal below.
func TestPinnedForkDurableFlowOutputProjectionKeepsThePlaceholderOutOfCanonicalJSON(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name string
		body string
	}{
		{
			// The unknown descriptor is a direct operand of the branch join.
			name: "unknown branch arm merged with a real one",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string; flag: boolean; items: readonly string[]; n: number }) => {
  const found = Step.run({ key: input.key })!
  return { value: found.value, v: (input.flag ? { w: input.items.length } : { w: input.n }).w }
})`,
		},
		{
			// The unknown descriptor is a FIELD of a branch arm's object
			// descriptor. Only the composite poisoning keeps it out of the
			// union here; the join guard alone would not see it.
			name: "branch arm whose object descriptor holds an unknown field",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string; flag: boolean; items: readonly string[]; n: number }) => {
  const found = Step.run({ key: input.key })!
  const chosen = input.flag ? { w: input.items.length } : { w: input.n }
  return { value: found.value, chosen }
})`,
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [Flow.artifactSource] }
`
			requireSoleDurableRefusal(
				t,
				compileDurableWith(t, backend, ctx, source),
				source,
				"Flow output cannot project length from durable array",
			)
		})
	}
}

// ---------------------------------------------------------------------------
// The Flow OUTPUT was only half the rule.
//
// `checkFlowOutput` walked the output expression and nothing else, so a
// projection the durable descriptor cannot answer stayed a compile-time-knowable
// error deferred into a runtime fault whenever it sat in an Action's INPUT:
//
//	class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
//	export const Flow = durable((input: { items: readonly string[] }) => {
//	  return Step.run({ key: input.items.length })
//	})
//
// Measured before this check existed: this bridge compiled it with zero
// diagnostics and RAN it, and so did the JS reference. The Plan it emitted
// carried `{"kind":"input","path":["items","length"]}` into the Action node's
// input; that Plan is accepted by the reference's own validator, and executing
// it through the reference `DurableExecutor` faults with
// `DurableActionDefect` wrapping `{"_tag":"ProjectionDefect","path":["items","length"]}`.
// Both implementations shared the hole, so it could only be closed on both
// sides at once — a fork-only fix would have manufactured a divergence.
//
// The fix is the SAME walk, not a second one. `durablePlanNodeValues` collects
// every value a Plan node consumes and `checkFlowBoundary` hands each to
// `flowOutputDescriptor` with its own subject. Every message and position below
// was measured against the JS reference backend on the same source text.
// ---------------------------------------------------------------------------

// TestPinnedForkDurableRefusesANodeInputProjectionItsDescriptorCannotAnswer
// crosses the projection spellings against the argument positions an Action
// input can take, and against the other values a Plan node consumes. Every
// program here compiled clean AND ran before this check existed.
func TestPinnedForkDurableRefusesANodeInputProjectionItsDescriptorCannotAnswer(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name    string
		body    string
		message string
	}{
		{
			// THE ORACLE.
			name: "object literal field",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  return Step.run({ key: input.items.length })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			// The whole argument IS the projection.
			name: "bare argument",
			body: `class Step extends Action<(input: number) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  return Step.run(input.items.length)
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			name: "nested object field",
			body: `class Step extends Action<(input: { outer: { key: number } }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  return Step.run({ outer: { key: input.items.length } })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			name: "array literal element",
			body: `class Step extends Action<(input: { keys: readonly number[] }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  return Step.run({ keys: [input.items.length] })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			// The const holds the container; the defect is the projection OFF it.
			name: "projection of a prior const binding",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  const c = input.items
  return Step.run({ key: c.length })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			// The const holds the defect; the argument is a bare identifier.
			name: "bare identifier bound to the projection",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  const n = input.items.length
  return Step.run({ key: n })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			name: "projection through a durable string",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { text: string }) => {
  return Step.run({ key: input.text.length })
})`,
			message: "Action main.sm#Step input cannot project length from durable string",
		},
		{
			// TypeScript types `pair.length` as the literal `2`, so nothing else
			// objects and the projection reaches the Plan.
			name: "non-numeric key on a durable tuple",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { pair: readonly [string, number] }) => {
  return Step.run({ key: input.pair.length })
})`,
			message: "Action main.sm#Step input cannot project length from durable tuple",
		},
		{
			name: "a field the descriptor lacks",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { obj: { a: string } }) => {
  return Step.run({ key: input.obj.missing })
})`,
			message: "Action main.sm#Step input projects missing durable field missing",
		},
		{
			name: "a nested projection whose last component misses",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { nested: { inner: { a: string } } }) => {
  return Step.run({ key: input.nested.inner.a.length })
})`,
			message: "Action main.sm#Step input cannot project length from durable string",
		},
		{
			// The bracketed spelling of the same defect must lower identically.
			name: "computed key spelling",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  return Step.run({ key: input.items["length"] })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			// The walk's Action leg, reached from an input rather than an output.
			name: "projection of a prior Action success",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: number }) => Result<{ done: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const first = Step.run({ key: input.key })!
  return Second.run({ key: first.value.length })
})`,
			message: "Action main.sm#Second input cannot project length from durable string",
		},
		{
			// The walk's signal leg, same.
			name: "projection of a signal payload",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const ticket = waitSignal<{ token: string }>("build.approval")
  return Step.run({ key: ticket.token.length })
})`,
			message: "Action main.sm#Step input cannot project length from durable string",
		},
		{
			name: "Action input inside a branch arm",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { flag: boolean; items: readonly string[]; n: number }) => {
  return input.flag ? Step.run({ key: input.items.length }) : Step.run({ key: input.n })
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			name: "sequential argument",
			body: `class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: string }) => Result<{ done: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[]; text: string }) => {
  const pair = sequential(Step.run({ key: input.items.length }), Second.run({ key: input.text }))
  return { pair }
})`,
			message: "Action main.sm#Step input cannot project length from durable array",
		},
		{
			// Not an Action input, but the same rule over the same walk: a timer
			// duration is a value the Plan evaluates too, and its subject names
			// the node rather than borrowing "Flow output".
			name: "sleep duration",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string; items: readonly string[] }) => {
  sleep(input.items.length)
  return Step.run({ key: input.key })
})`,
			message: "sleep duration cannot project length from durable array",
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [Flow.artifactSource] }
`
			requireSoleDurableRefusal(t, compileDurableWith(t, backend, ctx, source), source, probe.message)
		})
	}
}

// TestPinnedForkDurableNodeInputProjectionNamesTheOutputDefectFirst pins the
// ordering choice, which is the one place this addition could have changed an
// answer for a program that ALREADY refused.
//
// `checkFlowBoundary` collects the output's failures before any node's, so a
// program with defects in both keeps the exact sentence it had before the node
// walk existed. Measured on both backends: this program refused with the OUTPUT
// message before the change and refuses with the identical message after it.
func TestPinnedForkDurableNodeInputProjectionNamesTheOutputDefectFirst(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := durableProjectionPreamble + `
class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[]; text: string }) => {
  const first = Step.run({ key: input.items.length })!
  return { v: first.value, n: input.text.length }
})
export function main(): string[] { return [Flow.artifactSource] }
`
	requireSoleDurableRefusal(
		t,
		compileDurableWith(t, backend, ctx, source),
		source,
		"Flow output cannot project length from durable string",
	)
}

// TestPinnedForkDurableNodeInputProjectionReportsOneDeterministicSentence is the
// node-walk half of the traversal-order lesson.
//
// Two hazards, one test. Across NODES the order is the node slice, which is
// source order — so the first Action's defect is named, and the reference's node
// array agrees. Within one node's object literal the fields live in a Go `map`,
// so `flowOutputDescriptor`'s `sortUTF16` is what stops the same source from
// reporting a different sentence on different runs; three distinct sentences and
// many attempts make a mutation that drops the sort a gate rather than a coin
// toss.
func TestPinnedForkDurableNodeInputProjectionReportsOneDeterministicSentence(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := durableProjectionPreamble + `
class Step extends Action<(input: {
  alpha: number
  mike: number
  xray: number
}) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: {
  arr: readonly string[]
  text: string
  pair: readonly [string, number]
}) => {
  return Step.run({ alpha: input.arr.length, mike: input.text.length, xray: input.pair.length })
})
export function main(): string[] { return [Flow.artifactSource] }
`
	// `alpha` sorts before `mike` and `xray`, so the array defect is the one
	// both backends name; the other two would read "string" and "tuple".
	const want = "Action main.sm#Step input cannot project length from durable array"
	for attempt := 0; attempt < 24; attempt++ {
		requireSoleDurableRefusal(t, compileDurableWith(t, backend, ctx, source), source, want)
	}

	// The same rule where SOURCE order is the reverse of sorted order, so a walk
	// that happened to visit fields in authored order would name the other one.
	// The reference's `Object.keys(...).sort()` and this bridge's `sortUTF16`
	// pick the same field, which is what lets one corpus case pin one sentence
	// for both backends.
	reversed := durableProjectionPreamble + `
class Step extends Action<(input: { zulu: number; alpha: number }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[]; text: string }) => {
  return Step.run({ zulu: input.items.length, alpha: input.text.length })
})
export function main(): string[] { return [Flow.artifactSource] }
`
	for attempt := 0; attempt < 24; attempt++ {
		requireSoleDurableRefusal(
			t,
			compileDurableWith(t, backend, ctx, reversed),
			reversed,
			"Action main.sm#Step input cannot project length from durable string",
		)
	}
}

// TestPinnedForkDurableNodeInputProjectionCheckKeepsSoundProgramsRunning is the
// over-correction direction: every legitimate Action input must still compile
// and still run.
func TestPinnedForkDurableNodeInputProjectionCheckKeepsSoundProgramsRunning(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name string
		body string
	}{
		{
			name: "bare identifier argument",
			body: `class Step extends Action<(input: number) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { n: number }) => {
  return Step.run(input.n)
})`,
		},
		{
			name: "the whole Flow input object",
			body: `class Step extends Action<(input: { a: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { a: string }) => {
  return Step.run(input)
})`,
		},
		{
			name: "an object field the descriptor has",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { obj: { a: string } }) => {
  return Step.run({ key: input.obj.a })
})`,
		},
		{
			name: "a nested object and an array literal",
			body: `class Step extends Action<(input: { outer: { key: string }; keys: readonly string[] }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { a: string; b: string }) => {
  return Step.run({ outer: { key: input.a }, keys: [input.a, input.b] })
})`,
		},
		// "a numeric index into an input ARRAY" was here, feeding
		// `input.items[0]` to a required `key: string`. It compiled only while
		// `noUncheckedIndexedAccess` was unenforced; it is now refused, and
		// TestPinnedForkDurableArrayIndexProjectionIsRefusedUnderTheMandatoryOption
		// below records that with the three measurements that make it
		// inexpressible rather than merely unwritten. The tuple row directly
		// below keeps this table's index-projection coverage, and it is the
		// spelling that survives: a tuple read at a constant index is not
		// widened by the option.
		{
			name: "a numeric index into an input tuple",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { pair: readonly [string, number] }) => {
  return Step.run({ key: input.pair[0] })
})`,
		},
		{
			name: "a literal Action input",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  return Step.run({ key: "constant" })
})`,
		},
		{
			name: "a projection of a prior const binding",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { obj: { a: string } }) => {
  const c = input.obj
  return Step.run({ key: c.a })
})`,
		},
		{
			name: "a projection of a prior Action success",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: string }) => Result<{ done: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const first = Step.run({ key: input.key })!
  return Second.run({ key: first.value })
})`,
		},
		{
			name: "a projection of a signal payload",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const ticket = waitSignal<{ token: string }>("build.approval")
  return Step.run({ key: ticket.token })
})`,
		},
		{
			name: "Action inputs inside both branch arms",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { flag: boolean; key: string; other: string }) => {
  return input.flag ? Step.run({ key: input.key }) : Step.run({ key: input.other })
})`,
		},
		{
			name: "a literal sleep duration beside an Action input",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  sleep(25)
  return Step.run({ key: input.key })
})`,
		},
		{
			name: "a sequential pair whose inputs both project the Flow input",
			body: `class A extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
class B extends Action<(input: { k: string }) => Result<{ w: string }, Error>> {}
export const Flow = durable((input: { k: string; j: string }) => {
  const pair = sequential(A.run({ k: input.k }), B.run({ k: input.j }))
  return { v: pair[0].v, w: pair[1].w }
})`,
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [Flow.artifactSource] }
`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				encoded, _ := json.Marshal(result.Diagnostics)
				t.Fatalf("a sound Action input must still compile: emitSkipped=%v %s", result.EmitSkipped, encoded)
			}
			if got := runComptimeProgram(t, result); got != "static-plan-artifact" {
				t.Fatalf("emitted Flow did not run to a static Plan descriptor: %q", got)
			}
		})
	}
}

// A numeric index into an input ARRAY can no longer be a durable projection,
// and no spelling recovers it. That is a real consequence of making
// compatibility.mdx §Mandatory's `noUncheckedIndexedAccess` enforced, and it is
// recorded here rather than left as a deleted table row.
//
// Three measurements close it, all taken 2026-08-28 on this backend:
//
//   - `Step.run({ key: input.items[0] })` against a required `key: string` is
//     SMITHERS4100 — the read is `string | undefined` and does not satisfy the
//     Action's checked input contract.
//   - Widening the contract to `key: string | undefined` moves the refusal to
//     SMITHERS4113, "field key: undefined is not a canonical JSON value".
//     durable-execution.mdx's canonical JSON has no `undefined`, so the durable
//     boundary is right to refuse it.
//   - Narrowing at the projection with `input.items[0] ?? ""` is SMITHERS4111,
//     "unsupported durable expression KindBinaryExpression". A projection is a
//     path the descriptor answers; `??` is a computation, and the Plan cannot
//     record it.
//
// So the sound spelling of "index a durable container" is a TUPLE, whose read
// at a constant index the option does not widen. That row is in the sound table
// above and still passes.
func TestPinnedForkDurableArrayIndexProjectionIsRefusedUnderTheMandatoryOption(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := durableProjectionPreamble + `
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { items: readonly string[] }) => {
  return Step.run({ key: input.items[0] })
})
export function main(): string[] { return [Flow.artifactSource] }
`
	result := compileDurableWith(t, backend, ctx, source)
	if !result.EmitSkipped {
		t.Fatal("an array-index projection into a required durable field must be refused")
	}
	found := false
	for _, item := range result.Diagnostics {
		if item.Code == "SMITHERS4100" {
			found = true
		}
	}
	if !found {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("want SMITHERS4100 for the widened index read, got %s", encoded)
	}
}

// TestPinnedForkDurableNodeInputProjectionMatchesTheReferencePlan is the
// stronger half of the over-correction direction: not "it still compiles" but
// "it compiles to exactly the bytes the reference compiles it to".
//
// Each program exercises a node whose input the node-input walk visits. The
// node-input descriptors really are still derived-and-discarded — only the
// OUTPUT walk's descriptor becomes the Flow's success schema, which is the
// reference's own split (`flowSchemas` keeps `nodeInputFailures` out of the
// schema decision on purpose). What changed under this test is the success
// schema beside them; see the note on
// TestPinnedForkDurableFlowOutputProjectionDerivesTheSuccessSchema for why the
// pin is now cross-backend agreement rather than a historical snapshot. Every
// digest below was regenerated on 2026-08-28 by running both backends over that
// exact program and comparing the whole Plan, not just the digest.
func TestPinnedForkDurableNodeInputProjectionMatchesTheReferencePlan(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct {
		name   string
		body   string
		shape  string
		digest string
	}{
		{
			name: "Action input reads a prior Action success",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: string }) => Result<{ done: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const first = Step.run({ key: input.key })!
  return Second.run({ key: first.value })
})`,
			shape:  "structural",
			digest: "8606ec99adfb59112b2eb7f31a0993fd19db5b4e44dc622189072e20a5e09062",
		},
		{
			name: "Action input reads a signal payload",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  const ticket = waitSignal<{ token: string }>("build.approval")
  return Step.run({ key: ticket.token })
})`,
			shape:  "structural",
			digest: "959c7af7266aaf7240df1a824a7d3817e871dd279d6983604af21c8e55071272",
		},
		{
			name: "Action inputs inside both branch arms",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { flag: boolean; key: string; other: string }) => {
  return input.flag ? Step.run({ key: input.key }) : Step.run({ key: input.other })
})`,
			shape:  "structural",
			digest: "3fefdc06735af32555f87c9977b3744dd67319d244381fe02fbb058e9c39d014",
		},
		{
			name: "timer duration beside an Action input",
			body: `class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { key: string }) => {
  sleep(25)
  return Step.run({ key: input.key })
})`,
			shape:  "structural",
			digest: "5a63ea209681fcabbc29145e410457324b48ba2e551fcd54a06fa53b16c7f2dc",
		},
		{
			name: "Action input holding a nested object and an array literal",
			body: `class Step extends Action<(input: { outer: { key: string }; keys: readonly string[] }) => Result<{ value: string }, Error>> {}
export const Flow = durable((input: { a: string; b: string }) => {
  return Step.run({ outer: { key: input.a }, keys: [input.a, input.b] })
})`,
			shape:  "structural",
			digest: "95e09456b31dfae5fc5bcb6ed3689f3cc05e384f7864a3551dc236c96114ba9c",
		},
		{
			name: "sequential pair whose inputs both project the Flow input",
			body: `class A extends Action<(input: { k: string }) => Result<{ v: string }, Error>> {}
class B extends Action<(input: { k: string }) => Result<{ w: string }, Error>> {}
export const Flow = durable((input: { k: string; j: string }) => {
  const pair = sequential(A.run({ k: input.k }), B.run({ k: input.j }))
  return { v: pair[0].v, w: pair[1].w }
})`,
			shape:  "structural",
			digest: "bfe608c1e7dfd1be20a561e7f77b1d3e32e6d6f63edd92d7848d5adb0a285f54",
		},
		{
			// The Action-free control, and the one row whose digest did not
			// move; see the same row in the output test above.
			name: "no Action at all, structural success schema",
			body: `export const Flow = durable((input: { key: string }) => {
  return { key: input.key }
})`,
			shape:  "structural",
			digest: "e5c02f89c98de1b4a345215754153bdfc9c24fe103b76803c12a10e180b379ad",
		},
	} {
		t.Run(probe.name, func(t *testing.T) {
			source := durableProjectionPreamble + "\n" + probe.body + `
export function main(): string[] { return [Flow.artifactSource, Flow.plan.flowSchemas.success.shape, Flow.plan.digest] }
`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				encoded, _ := json.Marshal(result.Diagnostics)
				t.Fatalf("a sound node input must still compile: emitSkipped=%v %s", result.EmitSkipped, encoded)
			}
			want := "static-plan-artifact," + probe.shape + "," + probe.digest
			if got := runComptimeProgram(t, result); got != want {
				t.Fatalf("Plan no longer matches the reference:\n got %q\nwant %q", got, want)
			}
		})
	}
}
