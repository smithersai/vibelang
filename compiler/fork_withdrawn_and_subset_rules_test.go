package compiler

import (
	"strings"
	"testing"
)

// Seven diagnostic codes whose recorded status was wrong, measured on this
// backend rather than described.
//
// Three of them — `SMITHERS1704`, `SMITHERS1706`, `SMITHERS1708` — were the
// expression-form control-flow machinery, removed from the reference on
// 2026-08-23 when the specification that defined the grammar was withdrawn.
// `docs/src/pages/specification/control-flow.mdx` §No Expression-Form Grammar
// now says the opposite of the premise all three rested on: "Blocks, `if`,
// `switch`, `while`, and `for` are statements. None MUST be usable as an
// expression", and "Smithers MUST NOT add: `if` or `switch` in expression
// position, braced or braceless". So no program in the current language can
// reach any of the three, and the coverage ledger's citations for them point at
// `poc/src/language/control-flow.ts`, a file deleted in full by the same commit.
//
// A withdrawal is only supported if what it left behind is CORRECT, and that is
// the half nobody measured. `SMITHERS1704` refused every labeled statement the
// control-flow planner did not claim. The planner is gone, so a labeled
// statement is now an ordinary TypeScript statement — which
// control-flow.mdx §Existing TypeScript Forms requires ("Valid TypeScript
// statement forms MUST retain their TypeScript behavior") and which nothing
// asserted on either backend. `TestPinnedForkLabeledStatementsAreOrdinary` is
// that assertion, and it EXECUTES: a labeled statement that compiled and then
// jumped to the wrong place would satisfy a diagnostic-only test.
//
// The other four are durable codes a 2026-08-31 census reported as having
// "silently become reference-only". Re-derived here, they are three different
// facts and only one is a gap; see specification/durable-execution.mdx §(SA-2).
// What this file pins is the part of that argument a reader would otherwise have
// to take on trust.

// `SMITHERS1704` was withdrawn; what it used to refuse now compiles and runs.
//
// Both spellings, because the retired rule keyed on `ts.LabeledStatement` and
// covered both: a label on an iteration statement (whose `continue`/`break`
// target the labeled loop) and a label on a block (whose `break` leaves the
// block). The stdout is the point — `continue outer` that behaved like a plain
// `continue` would print four values instead of two and compile just as cleanly.
func TestPinnedForkLabeledStatementsAreOrdinary(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a labeled loop is continued from an inner loop",
			source: "export function main(): string[] {\n" +
				"  const out: string[] = []\n" +
				"  outer: for (const a of [1, 2]) {\n" +
				"    for (const b of [1, 2]) {\n" +
				"      if (b === 2) continue outer\n" +
				"      out.push(`${a}${b}`)\n" +
				"    }\n" +
				"  }\n" +
				"  return out\n" +
				"}\n",
			stdout: "11\n21",
		},
		{
			name: "a labeled block is broken out of",
			source: "export function main(): string[] {\n" +
				"  const out: string[] = []\n" +
				"  block: {\n" +
				"    out.push(\"a\")\n" +
				"    if (out.length === 1) break block\n" +
				"    out.push(\"b\")\n" +
				"  }\n" +
				"  return out\n" +
				"}\n",
			stdout: "a",
		},
		{
			name: "a labeled loop is broken out of from an inner loop",
			source: "export function main(): string[] {\n" +
				"  const out: string[] = []\n" +
				"  outer: for (const a of [1, 2]) {\n" +
				"    for (const b of [1, 2]) {\n" +
				"      if (a === 2) break outer\n" +
				"      out.push(`${a}${b}`)\n" +
				"    }\n" +
				"  }\n" +
				"  return out\n" +
				"}\n",
			stdout: "11\n12",
		},
	})
}

// `SMITHERS4114` is unreachable on this backend, and this is the argument.
//
// The reference reports it from four places: child-Flow embedding, `fanOut`,
// `loopWhile`, and an ordinary `Action.run`. The first three are refused HERE,
// earlier, by codes this backend does implement — which is what makes the fork's
// silence a smaller durable subset rather than a fail-open. The fourth cannot
// fire on its own: an Action id maps to exactly one descriptor unless a child
// Plan's actions are merged into the parent's table, and merging them is the
// child-Flow embedding refused below.
//
// Pinned rather than asserted in prose, so that a later change which teaches this
// backend any of the three constructs fails here and forces `SMITHERS4114` to be
// reconsidered in the same edit.
func TestPinnedForkDurableSubsetRefusesEveryPathToSMITHERS4114(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	childFlow := `import { durable } from "smithers:flows"
export const Inner = durable((input: { value: string }) => {
    return input.value
})
export const Outer = durable((input: { value: string }) => {
    return Inner.run({ value: input.value })
})
`
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, childFlow),
		"SMITHERS4120", strings.Index(childFlow, "Inner.run({ value: input.value })"))

	loop := `import { durable, loopWhile } from "smithers:flows"
export const Bad = durable((input: { start: number }) => {
    return loopWhile(input.start, (state: number) => state < 3, (state: number) => state + 1, 8)
})
`
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, loop),
		"SMITHERS4121", strings.Index(loop, "loopWhile(input.start"))

	fan := `import { durable, fanOut } from "smithers:flows"
export const Bad = durable((input: { values: string[] }) => {
    return fanOut(input.values, (value: string) => value, (value: string) => value)
})
`
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, fan),
		"SMITHERS4117", strings.Index(fan, "fanOut(input"))
}

// `SMITHERS4122` and `SMITHERS4123` ARE implemented here, contrary to a census
// that reported them reference-only.
//
// They are invisible to a literal grep because the bridge builds them from a
// `suffix:` field rather than spelling them, which is the same extraction defect
// the coverage ledger records for `SMITHERS1807` and `SMITHERS1708` in the other
// direction: text about a rule is not the rule, and a rule with no text is still
// a rule. This test spells them, so the census question is settled by the
// backend's own output.
//
// What genuinely differs is the RULE and not its presence: the reference refuses
// a malformed or conflicting suspension, and this backend refuses every one,
// because neither form is in its durable subset. That is a strict superset —
// fail-closed — and it is pinned here so a later narrowing cannot happen quietly.
func TestPinnedForkDurableSubsetRefusesBothSuspensionForms(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	broadcast := `import { durable, waitBroadcast } from "smithers:flows"
export const Bad = durable((input: { id: string }) => {
    return waitBroadcast<{ ok: boolean }>("signal.ok")
})
`
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, broadcast),
		"SMITHERS4122", strings.Index(broadcast, "waitBroadcast<{ ok: boolean }>(\"signal.ok\")"))

	queue := `import { durable, dequeue } from "smithers:flows"
export const Bad = durable((input: { id: string }) => {
    return dequeue<{ id: string }>("jobs")
})
`
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, queue),
		"SMITHERS4123", strings.Index(queue, "dequeue<{ id: string }>(\"jobs\")"))
}
