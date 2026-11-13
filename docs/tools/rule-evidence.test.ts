import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { anchors, canonical, changedRules, checkEntry, collectEntry, compileTwin, nearbyTwins, parseDiff, sentences, type Change, type Entry } from "./rule-evidence"
import { extract } from "./check-snippets"

const path = "docs/design/src/001-functions.md"
const doc = (after: string, before = ""): Change => ({ path, before, after })
const caseFile = (after: string, before = ""): Change => ({ path: "typescript/vibelang/cases/rule/main.vibe", before, after })
const entry = (...changes: Change[]): Entry => ({ base: "base", head: "head", changes })
const okTwin = async () => ({ ok: true, reason: "identical .d.ts" })
const paired = (vibe = "export const program = effect { return 1 }", ts = 'import { Effect } from "effect"\nexport const program = Effect.gen(function* () { return 1 })') =>
  "An `effect` block means an Effect value.\n\n```vibe\n" + vibe + "\n```\n\n```ts effect\n" + ts + "\n```\n"

for (const text of [
  "This fails with EK9201.", "The `try` keyword runs its operand.", "A handler must be a function.",
  "An invalid operand is an error.", "This compiles.", "This means a lazy value."
]) test("rejects missing evidence: " + text, async () => {
  const result = await checkEntry(entry(doc(text)), okTwin)
  expect(result.findings).toHaveLength(1)
  expect(result.findings[0].text).toBe(text)
  expect(result.findings[0].missing).toContain("changed compiler case")
  expect(result.findings[0].missing).toContain("compiled Effect twin")
})

test("covers VIPs, nested chapters and table cells, and exempts deletions", async () => {
  for (const p of ["docs/design/vips/0042-rule.md", "docs/design/src/nested/rule.md"]) {
    expect((await checkEntry(entry({ path: p, before: "", after: "It must compile." }))).findings).toHaveLength(1)
  }
  expect(changedRules([doc("| Form | Rule |\n| --- | --- |\n| `try` | means run |")])).toHaveLength(1)
  const removed = await checkEntry(entry(doc("", "`try` outside effect code is an error.")))
  expect(removed.findings).toEqual([])
})

test("reports replacement once with the full sentence and correct source line", () => {
  const rules = changedRules([doc("# Rules\n\nThe `Effect.fail` call\nmeans a typed failure.", "# Rules\n\nThe `Effect.fail` call\nmeans a defect.")])
  expect(rules).toEqual([{ path, line: 3, section: "rules", text: "The `Effect.fail` call means a typed failure." }])
  expect(sentences(path, "One ordinary sentence. An `Effect.fail` call means failure.")[1].text).toBe("An `Effect.fail` call means failure.")
})

for (const [before, after] of [
  ["A `try` must run.", "A `try`\nmust run."],
  ["The `try` must run.", "The **`try`** must run."],
  ["See [`try`](old.md).", "See [`try`](new.md)."],
  ["A `try` must run (decided detail 245).", "A `try` must run ([VIP-7](../vips/0007.md#rule))."],
  ["Teh `try` must run.", "The `try` must run."],
  ["# Old heading\n\nA `try` must run.", "# New heading\n\nA `try` must run."],
  ["The introduction has a typo.", "The introduction has a correction."]
]) test("exempts presentation/prose: " + after, () => {
  expect(changedRules([doc(after, before)])).toEqual([])
})

test("VIP-32 attribution-only privacy edit changes no normative sentences", () => {
  const before = "**Amended 2026-10-29: repos that already use VibeLang.** The published `vibelang-runtime` enforces its exact Effect pin, so the Effect upgrade lands together with the VibeLang release pinned to the new Effect, not before it (found by smithers-3a on Smithers). Recorded under Will's standing approval of recommendations."
  const after = before.replace("found by smithers-3a on Smithers", "found while upgrading Smithers")
  expect(changedRules([{ path: "docs/design/vips/0032-effect-version.md", before, after }])).toEqual([])
  expect(changedRules([doc(after.replace("pinned to the new Effect", "pinned to the current Effect"), before)])).toHaveLength(1)
})

test("EK1010 attribution-only privacy edit changes no normative sentences in all three locations", () => {
  const chapterBefore = "The new punctuator-only comma case is a warning until `vibelang --fix` can parenthesize it: Will's rule (effectscript-11, 23:05Z) is codemod first, then the error; a new error never lands ahead of its `--fix`."
  const chapterAfter = "The new punctuator-only comma case is a warning until `vibelang --fix` can parenthesize it: the preserving codemod ships before the new error; a new error never lands ahead of its `--fix`."
  const appendixBefore = "Its new punctuator-only comma case temporarily reports warning `EK1010` until the parenthesizing `vibelang --fix` ships, following Will's rule (effectscript-11, 23:05Z): codemod first, then the error."
  const appendixAfter = "Its new punctuator-only comma case temporarily reports warning `EK1010` until the parenthesizing `vibelang --fix` ships: the preserving codemod ships before the new error."
  const tableBefore = "| `EK1010` | warning for the new punctuator-only comma case until its parenthesizing `vibelang --fix` ships (Will, effectscript-11, 23:05Z: codemod first, then the error); existing operator-left violations (D186, S10-12) remain errors; parenthesize the operand or the throw | 41 | [Failures](003-failures.md#throw-expressions) |"
  const tableAfter = tableBefore.replace("Will, effectscript-11, 23:05Z: codemod first, then the error", "the preserving codemod ships before the new error")
  const changes = [
    { path: "docs/design/src/003-failures.md", before: chapterBefore, after: chapterAfter },
    { path: "docs/design/src/900-appendices.md", before: appendixBefore + "\n\n" + tableBefore, after: appendixAfter + "\n\n" + tableAfter }
  ]
  expect(changedRules(changes)).toEqual([])
  for (const [before, after] of [[chapterBefore, chapterAfter], [appendixBefore, appendixAfter], [tableBefore, tableAfter]]) {
    expect(changedRules([doc(after, before)])).toEqual([])
    expect(changedRules([doc(after.replace("before the new error", "after the new error"), before)])).toHaveLength(1)
  }
})

test("removing an agent, lane, ruling, veto or attribution column changes no normative sentences", () => {
  const record = "**Amended 2026-11-10: literal discriminants.** Codex Sol, lane `fix-match-exhaustive`, promotes the warning to error `EK4701` under the pre-alpha optimistic approval in ruling 16. The census found zero affected `.vibe` files. Will may overturn this decision."
  const credited = "**Amended 2026-11-10: literal discriminants.** The maintainers promote the warning to error `EK4701`. The census found zero affected `.vibe` files."
  const vip = "- **Amended 2026-11-10: literal discriminants.** Codex Sol, lane `fix-match-exhaustive`, extends `EK4701` to unions. This decision uses the pre-alpha optimistic approval in ruling 16. Will may overturn it. The diagnostic changes no `Exit`."
  const vipCredited = "- **Amended 2026-11-10: literal discriminants.** The maintainers extend `EK4701` to unions. The diagnostic changes no `Exit`."
  const table = (by: boolean) => [
    "| # | `.vibex` snippet | Rule |" + (by ? " Found by |" : ""),
    "| --- | --- | --- |" + (by ? " --- |" : ""),
    "| 1 | `const id = <T>(x: T) => x` | write `<T,>` |" + (by ? " Opus (fork, join), Fable |" : ""),
    "| 2 | `when < 5` | a comparison |" + (by ? " all four (Fable: no gap; probe disagrees) |" : ""),
    "| 3 | `fork <A/>` | `UnaryExpression` |" + (by ? " Astra, Sol |" : ""),
  ].join("\n") + "\n"
  for (const [before, after] of [
    [record, credited],
    [vip, vipCredited],
    [table(true), table(false)],
    ["| Idea | Author | Why not |\n| --- | --- | --- |\n| A `ScriptKindVibeX` | Astra (as fallback) | It reorders `try`. Fable's claim that `<A/>` is a call is wrong. |\n",
      "| Idea | Why not |\n| --- | --- |\n| A `ScriptKindVibeX` | It reorders `try`. The claim that `<A/>` is a call is wrong. |\n"],
    ["| 1 | `<T>(x: T) => x` | `.tsx`'s. Write `<T,>` instead | all four |\n", "| 1 | `<T>(x: T) => x` | `.tsx`'s. Write `<T,>` instead |\n"],
    ["An element is not a throw-tracked call (Opus), and a plain component stays plain (VIP-1 precondition; Opus, Fable) in `.vibex`.",
      "An element is not a throw-tracked call, and a plain component stays plain (VIP-1 precondition) in `.vibex`."],
    ["A `catch` handler is a function literal (decided detail 85; found by the round-19 Fable review).", "A `catch` handler is a function literal (decided detail 85; found by the round-19 review)."],
    ["**Status:** accepted, 2026-10-31. Merged from four submissions (Codex Astra, Codex Sol, Claude Opus, Claude Fable); `.tsx` decides.",
      "**Status:** accepted, 2026-10-31. Merged from four submissions; `.tsx` decides."],
  ]) expect(changedRules([doc(after, before)])).toEqual([])
})

test("removing a credit never hides a rule change made with it", () => {
  const record = "Codex Sol, lane `fix-match`, promotes the warning to error `EK4701` under the pre-alpha optimistic approval in ruling 16."
  for (const after of [
    "The maintainers promote the warning to error `EK4702`.",
    "The maintainers demote the warning to error `EK4701`.",
    "The maintainers promote the warning to error `EK4701` before the first release.",
  ]) expect(changedRules([doc(after, record)])).toHaveLength(1)
  // Only an attribution cell may go: dropping a rule-bearing cell, or a cell beside the credit, is a change.
  const row = "| 1 | `const id = <T>(x: T) => x` | write `<T,>` | Opus |"
  expect(changedRules([doc("| 1 | `const id = <T>(x: T) => x` | Opus |", row)])).toHaveLength(1)
  expect(changedRules([doc("| 1 | `const id = <T>(x: T) => x` |", row)])).toHaveLength(1)
  // A model identifier in code is part of the rule.
  expect(changedRules([doc('Use `Model.use("anthropic:claude-opus")` here.', 'Use `Model.use("anthropic:claude-fable")` here.')])).toHaveLength(1)
})

test("removing a private home path and its build host changes no normative sentences", () => {
  const home = "~" + "/migrate/TOOL-RISK.md", host = "nyc" + "-02"
  for (const [before, after] of [
    ["The tool-risk report (2026-10-29, `" + home + "` on " + host + ") found that Effect lint blocks `lint`.",
      "The tool-risk report (2026-10-29) found that Effect lint blocks `lint`."],
    ["The census (`" + home + "`) lists each `EK4701` site.", "The census lists each `EK4701` site."],
  ]) expect(changedRules([doc(after, before)])).toEqual([])
})

test("removing a private location never hides a rule change made with it", () => {
  const before = "The tool-risk report (2026-10-29, `" + "~" + "/migrate/TOOL-RISK.md` on " + "nyc" + "-02) found that Effect lint blocks `lint`."
  for (const after of [
    "The tool-risk report (2026-10-29) found that Effect lint blocks `lint:effect`.",
    "The tool-risk report (2026-10-29, `docs/TOOL-RISK.md`) found that Effect lint blocks `lint`.",
  ]) expect(changedRules([doc(after, before)])).toHaveLength(1)
})

test("editorial parentheses and discovery clauses normalize prose presentation", () => {
  for (const [before, after] of [
    ["The `rule` applies (editorial note).", "THE `rule` applies!"],
    ["The `rule` applies (found by Alice).", "The `rule` applies (reported by Bob)."],
    ["The `rule` applies, found by reviewer.", "The `rule` applies."],
    ["The `rule` applies (earlier note) (another note).", "The `rule` applies."],
    ["The `rule` applies; (editorial note) with care.", "The `rule` applies, with care."]
  ]) expect(changedRules([doc(after, before)])).toEqual([])
})

test("parenthetical and attribution stripping never hides rule-bearing changes", () => {
  for (const [before, after] of [
    ["EK1010", "EK1011"], ["TS2322", "TS2345"], ["4.1.1", "4.1.2"], ["0", "1"],
    ["`Result<T>`", "`Result<U>`"], ["Result", "Option"], ["string", "number"],
    ["readonly", "abstract"], ["await", "yield"], ["schema", "service"],
    ["a.b", "a.c"], ["a! + b", "a + b"], ["a | b", "a & b"], ["f(x)", "f(y)"],
    ["compiles", "does something"], ["means success", "means failure"],
    ["must pass", "must fail"], ["never pass", "never fail"], ["only pass", "only fail"],
    ["must pass", "pass"], ["not accepted", "accepted"], ["new error", "existing error"],
    ["`a.b`", "`a b`"], ["`value!`", "`value`"], ["`type`", "`Type`"]
  ]) {
    for (const wrap of [
      (note: string) => "The `rule` applies (" + note + ").",
      (note: string) => "The `rule` applies (found by reviewer: " + note + ").",
      (note: string) => "The `rule` applies, found by reviewer: " + note + ".",
      (note: string) => "The `rule` applies (Will's rule: " + note + ").",
      (note: string) => "The `rule` applies (editorial (" + note + "))."
    ]) expect(changedRules([doc(wrap(after), wrap(before))]), wrap(before) + " -> " + wrap(after)).toHaveLength(1)
    expect(changedRules([doc("The `rule` applies.", "The `rule` applies (" + before + ").")])).toHaveLength(1)
  }
  expect(changedRules([doc("The `rule` applies (a).", "The `rule` applies (a!).")])).toHaveLength(1)
  expect(changedRules([doc("The `call(note)` means failure.", "The `call` means failure.")])).toHaveLength(1)
  expect(changedRules([doc("The `call(found by reviewer)` means failure.", "The `call` means failure.")])).toHaveLength(1)
})

test("attribution removal preserves changes elsewhere and does not suppress new rules", async () => {
  const before = "The `rule` must pass (found by reviewer)."
  for (const after of [
    "The `rule` must fail (editorial note).",
    "The `rule` never passes.",
    "The `rule` must pass. The `other` must fail (editorial note)."
  ]) expect(changedRules([doc(after, before)])).toHaveLength(1)
  expect((await checkEntry(entry(doc("The `rule` must pass.", before)), okTwin)).findings).toEqual([])
  expect((await checkEntry(entry(doc("The `rule` must fail.", before)), okTwin)).findings).toHaveLength(1)
})

test("exempts generated pages, non-spec docs, unchanged moved rules and fenced code", () => {
  expect(changedRules([doc("<!-- Generated by docs. -->\n`try` must run.")])).toEqual([])
  expect(changedRules([{ path: "docs/user/src/rules.md", before: "", after: "`try` must run." }])).toEqual([])
  expect(changedRules([doc("```vibe\n// must compile\nconst x = 1\n```")])).toEqual([])
  expect(changedRules([doc("", "`try` must run."), { path: "docs/design/src/002-errors.md", before: "", after: "`try` must run." }])).toEqual([])
  expect(canonical("A `teh` must run.")).not.toBe(canonical("A `the` must run."))
  expect(changedRules([doc("`try` must not run.", "`try` must run.")])).toHaveLength(1)
})

test("a changed case and a changed diagnostic expectation are alternatives to twins", async () => {
  const result = await checkEntry(entry(doc("`try` runs an Effect."), caseFile("effect function f() { return try succeed(1) }")))
  expect(result.findings).toEqual([])
  expect(result.cases).toBe(1)
  expect((await checkEntry(entry(doc("A plain call is EK9201."), caseFile("// expect: EK9201\nf()",
    "// expect: EK9202\nf()")))).findings).toEqual([])
})

test("deleted, unchanged, comment-only, unrelated and generated-output cases do not count", async () => {
  for (const c of [
    caseFile("", "try succeed(1)"),
    caseFile("try succeed(1)", "try succeed(1)"),
    caseFile("// try\nconst x = 1", "const x = 1"),
    caseFile("const x = 1"),
    caseFile("// try\nconst x = 2", "const x = 1"),
    { ...caseFile("try succeed(1)"), path: "typescript/vibelang/cases/rule/out/main.js" }
  ]) expect((await checkEntry(entry(doc("`try` runs an Effect."), c))).findings).toHaveLength(1)
})

test("placeholder member names, grammar productions and explicit rule references count", async () => {
  for (const [text, source] of [
    ["A local `Users.Shape` means the service shape.", "service Local { value: Local.Shape }"],
    ["A `CatchExpression` means recovery.", "const x = fail(1) catch () => 2"],
    ["An operand must be a function.", "// rule-evidence: docs/design/src/001-functions.md\nconst f = () => 1"]
  ]) expect((await checkEntry(entry(doc(text), caseFile(source)))).findings).toEqual([])
})

test("every changed rule needs its own evidence", async () => {
  const result = await checkEntry(entry(doc("`try` means run. `schema` means a decoder."), caseFile("effect function f() { return try succeed(1) }")))
  expect(result.rules).toBe(2)
  expect(result.findings.map(f => f.text)).toEqual(["`schema` means a decoder."])
})

test("adjacent complete twins qualify only after compilation and API identity", async () => {
  const page = paired()
  const change = doc(page)
  const result = await checkEntry(entry(change), okTwin)
  expect(result.twins).toBe(1)
  expect(result.findings).toEqual([])
  const failed = await checkEntry(entry(change), async () => ({ ok: false, reason: "twin .d.ts differs" }))
  expect(failed.findings[0].missing).toContain("twin .d.ts differs")
})

for (const [name, page] of [
  ["missing TypeScript", paired().replace(/```ts effect[\s\S]*/, "")],
  ["ordinary TypeScript fence", paired().replace("ts effect", "ts")],
  ["pending", paired("// pending: VIP-1\nexport const program = effect { return 1 }")],
  ["fragment", paired("// fragment\nexport const program = effect { return 1 }")],
  ["expected error", paired("// expect-error: EK1001\nexport const program = effect { return 1 }")],
  ["compiler gap", paired("// compiler-gap: no\nexport const program = effect { return 1 }")],
  ["different heading", paired().replace("\n\n```vibe", "\n\n# Other\n\n```vibe")],
  ["too far away", paired().replace("\n\n```vibe", "\n".repeat(50) + "```vibe")],
  ["unrelated witness", paired("export const number = 1")]
]) test("rejects twin escape: " + name, async () => {
  expect((await checkEntry(entry(doc(page)), okTwin)).findings.length).toBeGreaterThan(0)
})

test("mutation matrix never accepts a changed code/negation with only prose evidence", async () => {
  for (const form of ["try", "fork", "join", "schema", "provide", "restore"]) {
    for (const predicate of ["must run", "must not run", "is an error", "compiles", "means failure"]) {
      const before = "`" + form + "` means success."
      const after = "`" + form + "` " + predicate + "."
      const result = await checkEntry(entry(doc(after, before)), okTwin)
      expect(result.findings, after).toHaveLength(1)
    }
  }
  expect(anchors("The `try` emits EK9201.")).toEqual(["EK9201"])
})

test("real compiler checks both twins, declaration mismatch, syntax errors and vacuous APIs", async () => {
  const make = (text: string) => {
    const blocks = extract(text)
    return { vibe: blocks[0], effect: blocks[1] }
  }
  const good = make(paired())
  expect(await compileTwin(good)).toEqual({ ok: true, reason: "identical .d.ts" })
  const mismatch = make(paired(undefined, 'import { Effect } from "effect"\nexport const program = Effect.succeed("different")'))
  expect((await compileTwin(mismatch)).reason).toBe("twin .d.ts differs")
  for (const broken of [make(paired("export const program = effect { return missing }")),
    make(paired(undefined, "export const program: number = 'bad'"))]) {
    expect((await compileTwin(broken)).reason).toContain("did not compile")
  }
  expect((await compileTwin(make(paired("export {}", "export {}")))).reason).toContain("empty API")
}, 120_000)

test("jj entry collection includes case edits and rule deletions without reading working-copy changes", () => {
  const root = mkdtempSync(join(tmpdir(), "rule-evidence-jj-"))
  const jj = (...args: string[]) => {
    const result = spawnSync("jj", args, { cwd: root, encoding: "utf8" })
    if (result.status) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  try {
    jj("git", "init")
    mkdirSync(join(root, "docs/design/src"), { recursive: true })
    writeFileSync(join(root, path), "`try` must run.")
    jj("describe", "-m", "base rule")
    const base = jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    jj("new")
    writeFileSync(join(root, path), "`try` must not run.")
    jj("describe", "-m", "changed rule")
    const head = jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    writeFileSync(join(root, path), "Unrelated unsnapshotted edit.")
    const collected = collectEntry(root, base, head)
    expect(collected.changes).toEqual([doc("`try` must not run.", "`try` must run.")])
    expect(collected.head).toBe(head)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("fast-check: semantic mutations always require evidence, presentation always preserves it", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("try", "fork", "join", "service", "schema", "provide", "restore"),
    fc.constantFrom("must run", "must not run", "is an error", "compiles", "means failure"),
    fc.integer({ min: 1, max: 10 }),
    async (form, predicate, spaces) => {
      const before = "`" + form + "` means success."
      const after = "`" + form + "` " + predicate + "."
      expect((await checkEntry(entry(doc(after, before)), okTwin)).findings).toHaveLength(1)
      expect(changedRules([doc(after.replaceAll(" ", " ".repeat(spaces)), after)])).toEqual([])
      const source = "// rule-evidence: " + path + "\nexport const witness = " + JSON.stringify(form)
      expect((await checkEntry(entry(doc(after, before), caseFile(source)))).findings).toEqual([])
    }), { seed: 20261103, numRuns: 250 })
})

test("HTML comments cannot swallow a rule and fences protect example comment text", () => {
  expect(changedRules([doc("<!-- note --> `try` must run.")])).toHaveLength(1)
  expect(changedRules([doc("`try` must run. <!-- note -->")])).toHaveLength(1)
  expect(changedRules([doc('```vibe\nconst s = "<!--"\n```\n\n`try` must run.')])).toHaveLength(1)
  expect(sentences(path, "Normal prose.\n`try` must run.")[1].line).toBe(2)
})

test("an invalid unrelated legacy fence cannot abort another rule's evidence check", async () => {
  const legacy = "```ts\n// load.vibe\nconst x = 1\n```\n\n"
  expect((await checkEntry(entry(doc(legacy + paired())), okTwin)).findings).toEqual([])
})

test("the target refuses mutable revision names before a cached verdict is possible", () => {
  const result = spawnSync(process.execPath, [resolve(import.meta.dir, "rule-evidence.ts"),
    "--immutable", "--base", "@-", "--head", "vibe@github"], { encoding: "utf8" })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain("full immutable")
})

test("full-context diff parsing preserves additions, deletions, renames and final newlines", () => {
  const patch = [
    "diff --git a/docs/design/src/old.md b/docs/design/src/new.md",
    "--- a/docs/design/src/old.md", "+++ b/docs/design/src/new.md", "@@ -1 +1 @@",
    "-`try` must run.", "\\ No newline at end of file", "+`fork` must run.",
    "diff --git a/typescript/vibelang/cases/x/main.vibe b/typescript/vibelang/cases/x/main.vibe",
    "new file mode 100644", "--- /dev/null", "+++ b/typescript/vibelang/cases/x/main.vibe",
    "@@ -0,0 +1 @@", "+export const x = fork f()", "\\ No newline at end of file"
  ].join("\n")
  expect(parseDiff(patch)).toEqual([
    { path: "docs/design/src/old.md", before: "`try` must run.", after: "" },
    { path: "docs/design/src/new.md", before: "", after: "`fork` must run.\n" },
    { path: "typescript/vibelang/cases/x/main.vibe", before: "", after: "export const x = fork f()" }
  ])
  expect(() => parseDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -99 +99 @@\n-old\n+new")).toThrow("incomplete")
})

test("PACKAGE declares an explicit diff target and its regression target", () => {
  const text = readFileSync(process.env.RULE_EVIDENCE_PACKAGE || resolve(import.meta.dir, "../../PACKAGE.ts"), "utf8")
  expect(text.includes('"spec-rule-evidence": specRuleEvidence')).toBe(true)
  expect(text.includes('"spec-rule-evidence-test": specRuleEvidenceTest')).toBe(true)
  expect(text).toContain('shell: "bun docs/tools/rule-evidence.ts --immutable"')
})

test("real Effect twins may compare their Exit instead of their declarations", async () => {
  const pair = (vibe: string, ts: string) => {
    const blocks = extract(paired("// rule-evidence-exit: program\n" + vibe, "// rule-evidence-exit: program\n" + ts))
    return { vibe: blocks[0], effect: blocks[1] }
  }
  const result = await compileTwin(pair("export const program = effect { return 1 }",
    'import { Effect } from "effect"\nexport const program = Effect.succeed(1 as const)'))
  expect(result).toEqual({ ok: true, reason: "identical Exit" })
  expect((await compileTwin(pair("export const program = effect { return 1 }",
    'import { Effect } from "effect"\nexport const program = Effect.succeed(2)'))).reason).toContain("twin Exit differs")
  const bad = pair("export const program = 1", "export const program = 1")
  expect((await compileTwin(bad)).reason).toContain("must export an Effect")
}, 120_000)

test("existing VIP citations attribute case witnesses and Effect version citations are prose", async () => {
  const vip = { path: "docs/design/vips/0027-output.md", before: "", after: "A cycle emits `any` instead of TS5088." }
  const change = caseFile("// VIP-27: recursive declaration witness\nexport const cycle = () => cycle")
  expect((await checkEntry(entry(vip, change))).findings).toEqual([])
  expect((await checkEntry(entry(vip, doc("A cycle avoids TS5088."), change))).findings).toEqual([])
  expect(changedRules([doc("Effect 4.1.1 `for concurrent` means parallel work.",
    "Effect 4.1.0 `for concurrent` means parallel work.")])).toEqual([])
  expect(changedRules([doc("The value is `4.1.1`.", "The value is `4.1.0`.")])).toHaveLength(1)
  expect(anchors("A `__proto__` field means data.")).toContain("__proto__")
})

test("unchanged diagnostic range notes are prose, and version manifests exercise the pin", async () => {
  expect(changedRules([doc("`EK0504` to `EK0511` keep their specific triggers.")])).toEqual([])
  expect(changedRules([doc("`EK0504` to `EK0511` mean a different error.")])).toHaveLength(1)
  const rule = doc('The compiler reads `effect/package.json`; any version other than `4.1.1` is `EK3201`.')
  const manifest = { path: "typescript/vibelang/cases/pin/package.json",
    before: '{"dependencies":{"effect":"4.1.0"}}', after: '{"dependencies":{"effect":"4.1.1"}}' }
  expect((await checkEntry(entry(rule, manifest))).findings).toEqual([])
  expect((await checkEntry(entry(rule, { ...manifest, after: '{"dependencies":{"other":"4.1.1"}}' }))).findings).toHaveLength(1)
})

test("a deletion cannot cover a different new rule in the same section", async () => {
  const change = doc("# Rules\n\n`schema` means a decoder.", "# Rules\n\n`try` is an error.")
  const result = await checkEntry(entry(change))
  expect(result.findings).toHaveLength(1)
  expect(result.findings[0].text).toBe("`schema` means a decoder.")
  expect(changedRules([doc('`const version = "Effect 4.1.1"` is a string.',
    '`const version = "Effect 4.1.0"` is a string.')])).toHaveLength(1)
})

test("copying an unchanged published sentence into its VIP adds no new rule", () => {
  expect(changedRules([doc("`try` must run.", "`try` must run."),
    { path: "docs/design/vips/0005-rule.md", before: "", after: "`try` must run." }])).toEqual([])
})

// Will, 2026-11-03: unimplemented specs may have test.todo, but each rule
// must at least have a test. Pending coverage is never executable coverage.
const pendingSource = (text = "`try` must run.", reference = path, state = "present") =>
  'import { test } from "bun:test"\n' +
  'test.todo(' + JSON.stringify(`rule-evidence: ${reference} | explicit run | ${state} | ${text}`) + ')\n'
const pendingFile = (after: string, before = ""): Change =>
  ({ path: "docs/tools/spec-new-rules-pending.test.ts", before, after })

test("pending witness counts an exact changed test.todo separately from executable coverage", async () => {
  const result = await checkEntry(entry(doc("# Rules\n\n`try` must run."),
    pendingFile(pendingSource("`try` must run.", path + "#rules"))))
  expect(result.findings).toEqual([])
  expect(result.pending).toBe(1)
  expect(result.cases).toBe(0)
  expect(result.twins).toBe(0)
})

test("pending witness cannot cover another sentence, chapter, section or removal state", async () => {
  for (const source of [
    pendingSource("`try` must not run.", path + "#rules"),
    pendingSource("`try` must run.", "docs/design/src/002-running.md#rules"),
    pendingSource("`try` must run.", path + "#other"),
    pendingSource("`try` must run.", path),
    pendingSource("`try` must run.", path + "#rules", "removed")
  ]) expect((await checkEntry(entry(doc("# Rules\n\n`try` must run."), pendingFile(source)))).findings).toHaveLength(1)
  const result = await checkEntry(entry(doc("", "`try` must run."),
    pendingFile(pendingSource("`try` must run.", path, "removed"))))
  expect(result.findings).toEqual([])
  expect(result.pending).toBe(0)
})

test("pending witness rejects unchanged, renamed, deleted and comment-only todo changes", async () => {
  const source = pendingSource()
  for (const file of [
    pendingFile(source, source), pendingFile(source + "// another comment\n", source),
    pendingFile(source.replace("explicit run", "renamed"), source), pendingFile("", source),
    pendingFile("// " + source.replaceAll("\n", "\n// ")),
    pendingFile('const fixture = ' + JSON.stringify(source)),
    { ...pendingFile(source), path: "docs/tools/fixture.ts" }
  ]) expect((await checkEntry(entry(doc("`try` must run."), file))).findings).toHaveLength(1)
})

test("pending witness requires a real imported top-level test.todo call", async () => {
  const source = pendingSource()
  for (const text of [
    source.replace('"bun:test"', '"./fake"'), source.replace("test.todo", "other.todo"),
    source.replace("test.todo", "test.skip"), source.replace("test.todo", "test"),
    source.replace("test.todo(", "function neverCalled() { test.todo(") + "}",
    source.replace("test.todo(", "if (false) test.todo("),
    source.replace('import { test } from "bun:test"', 'const test = { todo() {} }')
  ]) expect((await checkEntry(entry(doc("`try` must run."), pendingFile(text)))).findings).toHaveLength(1)
  expect((await checkEntry(entry(doc("`try` must run."),
    pendingFile(source.replaceAll("test.todo", "check.todo").replace("{ test }", "{ test as check }"))))).pending).toBe(1)
})

test("pending witness diff collection retains the test file and immutable revision contents", () => {
  const body = pendingSource()
  const patch = ["diff --git a/docs/tools/spec-new-rules-pending.test.ts b/docs/tools/spec-new-rules-pending.test.ts",
    "new file mode 100644", "--- /dev/null", "+++ b/docs/tools/spec-new-rules-pending.test.ts", "@@ -0,0 +1,2 @@",
    ...body.trimEnd().split("\n").map(line => "+" + line)].join("\n")
  expect(parseDiff(patch)).toEqual([pendingFile(body)])
})

test("pending witness property: one test covers only its exact rule, including negations and codes", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("try", "fork", "join", "schema", "service"),
    fc.integer({ min: 1000, max: 9998 }), async (form, code) => {
      const text = `The \`${form}\` form must report EK${code}.`
      const witness = pendingFile(pendingSource(text))
      expect((await checkEntry(entry(doc(text), witness))).pending).toBe(1)
      expect((await checkEntry(entry(doc(text.replace("must report", "must not report")), witness))).findings).toHaveLength(1)
      expect((await checkEntry(entry(doc(text.replace(`EK${code}`, `EK${code + 1}`)), witness))).findings).toHaveLength(1)
    }), { seed: 20261103, numRuns: 100 })
})

test("pending witness covers only one of two rules in the same chapter section", async () => {
  const result = await checkEntry(entry(doc("`try` must run. `fork` must run."), pendingFile(pendingSource())))
  expect(result.pending).toBe(1)
  expect(result.findings.map(f => f.text)).toEqual(["`fork` must run."])
})

const citedCase = (text: string, body = 'export const witness = fail("bad") catch () => "ok"') =>
  caseFile(`// rule-evidence: ${path}#meaning | ${text}\n${body}`)
const oldCatch = "On a failure in its error channel it calls `h` with the error, as Zig's `catch |err|` does."
const newCatch = "On a failure in its error channel it calls `h` with the error."

test("deletions add no obligation, while replacement and new rules still need evidence", async () => {
  expect((await checkEntry(entry(doc("", oldCatch)))).findings).toEqual([])
  const result = await checkEntry(entry(doc("`schema` means a decoder.", oldCatch)))
  expect(result.rules).toBe(1)
  expect(result.findings.map(f => f.text)).toEqual(["`schema` means a decoder."])
})

test("a rewording inherits the existing case when its exact citation is repointed", async () => {
  const before = citedCase(oldCatch).after, after = citedCase(newCatch).after
  const result = await checkEntry(entry(doc("# Meaning\n\n" + newCatch, "# Meaning\n\n" + oldCatch), caseFile(after, before)))
  expect(result.findings).toEqual([])
  expect(result.inherited).toBe(1)
  expect(result.cases).toBe(0)
})

test("repointed quote assertions preserve the executable spec witness", async () => {
  const quote = (text: string) => `import { test } from "bun:test"\nimport { expect } from "bun:test"\nimport { readFileSync } from "node:fs"\ntest("catch rule", () => { expect(readFileSync(${JSON.stringify(path)}, "utf8")).toContain(${JSON.stringify(text)}) })\n`
  const result = await checkEntry(entry(doc(newCatch, oldCatch), pendingFile(quote(newCatch), quote(oldCatch))))
  expect(result.findings).toEqual([])
  expect(result.inherited).toBe(1)
})

test("quote inheritance rejects fixtures, pending tests, uncalled functions and changed checks", async () => {
  const quote = (text: string) => `import { test } from "bun:test"\nconst chapter = "${path}"\ntest("rule", () => { expect(read(chapter)).toContain(${JSON.stringify(text)}); expect(run()).toBe(1) })`
  const before = quote(oldCatch), after = quote(newCatch)
  for (const transform of [
    (s: string) => s.replace('"bun:test"', '"./fake"'),
    (s: string) => s.replace('test("rule",', 'test.todo("rule",'),
    (s: string) => s.replace('test("rule",', 'test.skip("rule",'),
    (s: string) => 'import { test } from "bun:test"; const fixture = ' + JSON.stringify(s),
    (s: string) => 'function neverCalled() { ' + s.replace('import { test } from "bun:test"', '') + ' }',
  ]) expect((await checkEntry(entry(doc(newCatch, oldCatch), pendingFile(transform(after), transform(before))))).findings).toHaveLength(1)
  expect((await checkEntry(entry(doc(newCatch, oldCatch), pendingFile(after.replace("toBe(1)", "toBe(2)"), before)))).findings).toHaveLength(1)
})

test("inheritance rejects stale, unrelated, fabricated, removed and changed-code citations", async () => {
  const change = doc("# Meaning\n\n" + newCatch, "# Meaning\n\n" + oldCatch)
  const old = citedCase(oldCatch).after, next = citedCase(newCatch).after
  for (const c of [caseFile(old, old), caseFile(next), caseFile("", old),
    caseFile(next, old.replace(oldCatch, "An unrelated `catch` rule.")),
    caseFile(next.replace("#meaning", "#other"), old),
    caseFile(next.replace(path, "docs/design/src/other.md"), old),
    caseFile(next.replace('export const witness = fail("bad") catch () => "ok"', "// no witness"), old),
    caseFile(next.replace('export const witness', 'export const changed'), old)
  ]) expect((await checkEntry(entry(change, c))).inherited).toBe(0)
  const result = await checkEntry(entry(doc("# Meaning\n\n`catch` reports EK9202.", "# Meaning\n\n`catch` reports EK9201."),
    caseFile(citedCase("`catch` reports EK9202.").after, citedCase("`catch` reports EK9201.").after)))
  expect(result.findings).toHaveLength(1)
})

test("fast-check: deletion and repointed citations do not exempt fresh rules or stable-code mutations", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("try", "fork", "join", "restore", "schema"),
    fc.integer({ min: 1000, max: 9998 }), async (form, code) => {
      const before = `The \`${form}\` form must report EK${code}, as specified here.`
      const after = `The \`${form}\` form must report EK${code}.`
      const changed = doc("# Meaning\n\n" + after, "# Meaning\n\n" + before)
      const source = (s: string) => citedCase(s, `export const witness = ${JSON.stringify(form)}`).after
      expect((await checkEntry(entry(doc("", before)))).rules).toBe(0)
      expect((await checkEntry(entry(changed, caseFile(source(after), source(before))))).inherited).toBe(1)
      expect((await checkEntry(entry(changed))).findings).toHaveLength(1)
      // Diagnostic identity alone cannot prove that a new trigger or polarity is unchanged.
      expect((await checkEntry(entry(doc(after.replace("must report", "must not report"), after)))).findings).toHaveLength(1)
      expect((await checkEntry(entry(changed, doc("A new `service` must compile."), caseFile(source(after), source(before))))).findings).toHaveLength(1)
    }), { seed: 20261104, numRuns: 150 })
})

test("fold-details' seventeen findings reduce to five inherited rules and no new obligations", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/rule-evidence-simplification.json", import.meta.url), "utf8"))
  const result = await checkEntry(entry(...fixture.changes))
  expect(result.rules).toBe(5)
  expect(result.inherited).toBe(5)
  expect(result.cases).toBe(0)
  expect(result.pending).toBe(0)
  expect(result.findings).toEqual([])
  const fresh = await checkEntry(entry(...fixture.changes, doc("A new `schema` rule must compile.")))
  expect(fresh.findings.map(f => f.text)).toEqual(["A new `schema` rule must compile."])
})


const proposalPath = "docs/design/vips/0054-platform-model-open.md"
const proposal = (status: string, body = "Candidate A means `node` must compile. Candidate B means `node` is an error.") =>
  "# Platform model\n\n**Status:** " + status + ", 2026-11-07.\n\n## Candidates\n\n" + body
const proposalChange = (after: string, before = ""): Change => ({ path: proposalPath, before, after })
const openRow = "| [54](0054-platform-model-open.md) | `node` must compile | open |"
const indexChange = (row = openRow): Change => ({
  path: "docs/design/vips/README.md", before: "", after: "## Open\n\n| VIP | Title | Status |\n| --- | --- | --- |\n" + row
})

for (const status of ["open", "proposed"]) test(status + " VIP candidates require no evidence", async () => {
  const result = await checkEntry(entry(proposalChange(proposal(status)), indexChange()), okTwin)
  expect(result.rules).toBe(0)
  expect(result.findings).toEqual([])
  expect([result.cases, result.twins, result.pending, result.inherited]).toEqual([0, 0, 0, 0])
})

test("accepted VIP candidates and Clarified amendments still require evidence", async () => {
  const result = await checkEntry(entry(proposalChange(proposal("accepted"))), okTwin)
  expect(result.rules).toBe(2)
  expect(result.findings).toHaveLength(2)
  for (const marker of ["Clarified", "Amended"]) {
    const before = proposal("accepted", "An ordinary introduction.")
    const after = before + "\n\n- **" + marker + ":** `node` must compile."
    expect((await checkEntry(entry(proposalChange(after, before)), okTwin)).findings).toHaveLength(1)
  }
})

test("acceptance makes unchanged candidate sentences normative", async () => {
  for (const status of ["open", "proposed"]) {
    const result = await checkEntry(entry(proposalChange(proposal("accepted"), proposal(status))), okTwin)
    expect(result.rules).toBe(2)
    expect(result.findings).toHaveLength(2)
  }
})

test("an open-table label cannot exempt an accepted VIP or a chapter", () => {
  expect(changedRules([proposalChange(proposal("accepted")), indexChange()])).toHaveLength(3)
  expect(changedRules([doc(proposal("open"))])).toHaveLength(2)
  expect(changedRules([indexChange()])).toHaveLength(1)
  expect(changedRules([proposalChange("No status. `node` must compile.")])).toHaveLength(1)
})

test("open VIP prose cannot establish an inherited rule in a chapter", () => {
  const text = "`node` must compile."
  expect(changedRules([
    proposalChange("", proposal("open", text)), doc(text)
  ])).toEqual([{ path, line: 1, text, section: "" }])
})

test("landed open VIP-53 and its README row remain non-normative", async () => {
  const vipPath = "docs/design/vips/0053-rename-smithersscript-open.md"
  const after = readFileSync(resolve(import.meta.dir, "../design/vips/0053-rename-smithersscript-open.md"), "utf8")
  const row = readFileSync(resolve(import.meta.dir, "../design/vips/README.md"), "utf8")
    .split("\n").find(line => line.startsWith("| [53]"))!
  const result = await checkEntry(entry({ path: vipPath, before: "", after }, indexChange(row)), okTwin)
  expect(result.rules).toBe(0)
  expect(result.findings).toEqual([])
})

test("fast-check: VIP authority follows its own status across candidate and amendment wording", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("open", "proposed"),
    fc.constantFrom("must compile", "is an error", "means a value"),
    fc.constantFrom("Candidates", "Amended", "Clarified", "Accepted"),
    fc.integer({ min: 1, max: 9999 }),
    async (status, wording, heading, code) => {
      const body = "## " + heading + "\n\n`form" + code + "` " + wording + "."
      const before = proposal(status, body), after = proposal("accepted", body)
      expect((await checkEntry(entry(proposalChange(before)), okTwin)).rules).toBe(0)
      const accepted = await checkEntry(entry(proposalChange(after, before)), okTwin)
      expect(accepted.rules).toBe(1)
      expect(accepted.findings).toHaveLength(1)
    }
  ), { numRuns: 100 })
})

test("jj README-only changes use the linked VIP status at immutable revisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "rule-evidence-status-jj-"))
  const jj = (...args: string[]) => {
    const result = spawnSync("jj", args, { cwd: root, encoding: "utf8" })
    if (result.status) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  const indexPath = "docs/design/vips/README.md"
  try {
    jj("git", "init")
    mkdirSync(join(root, "docs/design/vips"), { recursive: true })
    writeFileSync(join(root, proposalPath), proposal("open"))
    jj("describe", "-m", "proposal")
    const base = jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    jj("new")
    writeFileSync(join(root, indexPath), indexChange().after)
    jj("describe", "-m", "index proposal")
    const head = jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    writeFileSync(join(root, proposalPath), proposal("accepted"))
    expect((await checkEntry(collectEntry(root, base, head), okTwin)).rules).toBe(0)
    jj("describe", "-m", "accept proposal")
    const accepted = jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    expect((await checkEntry(collectEntry(root, head, accepted), okTwin)).findings).toHaveLength(2)
    jj("new")
    writeFileSync(join(root, indexPath), indexChange(openRow.replace("must compile", "means a value")).after)
    jj("describe", "-m", "edit stale open row")
    const indexed = jj("log", "--no-graph", "-r", "@", "-T", "commit_id")
    writeFileSync(join(root, proposalPath), proposal("open"))
    expect((await checkEntry(collectEntry(root, accepted, indexed), okTwin)).findings).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)

test("status text inside examples or comments cannot exempt accepted or unknown VIPs", () => {
  for (const fake of ["<!-- **Status:** open -->", "`**Status:** open`", "```md\n**Status:** open\n```"]) {
    expect(changedRules([proposalChange(fake + "\n\n`node` must compile.")]).length).toBeGreaterThan(0)
    expect(changedRules([proposalChange(proposal("accepted") + "\n\n" + fake)]).length).toBeGreaterThan(0)
  }
})

for (const path of [
  "docs/design/vips/reviews/2026-11-09-built-in-set.md",
  "docs/design/vips/reviews/2026-11-09-built-in-set-index.md"
]) test("proposed supporting document is non-normative: " + path, async () => {
  const result = await checkEntry(entry({ path, before: "", after: proposal("proposed") }), okTwin)
  expect(result.rules).toBe(0)
  expect(result.findings).toEqual([])
})

test("fast-check: supporting reviews preserve status authority and acceptance evidence", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("open", "proposed"),
    fc.constantFrom("review", "index", "nested/review"),
    fc.integer({ min: 1, max: 9999 }),
    async (status, suffix, code) => {
      const path = "docs/design/vips/reviews/set-" + code + "-" + suffix + ".md"
      const before = proposal(status, "`form" + code + "` must compile.")
      expect((await checkEntry(entry({ path, before: "", after: before }), okTwin)).rules).toBe(0)
      const accepted = await checkEntry(entry({ path, before, after: before.replace("**Status:** " + status, "**Status:** accepted") }), okTwin)
      expect(accepted.rules).toBe(1)
      expect(accepted.findings).toHaveLength(1)
      for (const fake of ["<!-- **Status:** proposed -->", "```md\n**Status:** proposed\n```", ""]) {
        const unknown = await checkEntry(entry({ path, before: "", after: fake + "\n\n`form` must compile." }), okTwin)
        expect(unknown.findings).toHaveLength(1)
      }
    }
  ), { numRuns: 100 })
})

test("a quotation blockquote records words, not a rule; a quoted code span and a bare blockquote stay rules", () => {
  const path = "docs/design/vips/README.md", before = "# VIPs\n\n## Acceptance\n\nIntro.\n"
  const add = (line: string) => changedRules([{ path, before, after: before + "\n" + line + "\n" }])
  expect(add('> "approval just means it is ready to be discussed"')).toHaveLength(0)
  expect(add("> “this means a vote”")).toHaveLength(0)
  expect(add('> "a `task` means a step"')).toHaveLength(1)
  expect(add("> approval means it is ready")).toHaveLength(1)
  fc.assert(fc.property(fc.stringMatching(/^[a-z]{1,12}( [a-z]{1,12}){0,4}$/), words =>
    add('> "' + words + ' means ' + words + '"').length === 0 && add(words + " means " + words + ".").length === 1))
})


const recordPath = "docs/design/vips/0034-compiler-and-tooling.md"
const quotationRecord = readFileSync(new URL("./fixtures/rule-evidence-quotation-record.md", import.meta.url), "utf8")
const recordChange = (after: string, before = ""): Change => ({ path: recordPath, before, after })

test("dated quotation records retain the exact multi-sentence words and question context without rule evidence", async () => {
  const result = await checkEntry(entry(recordChange(quotationRecord)), okTwin)
  expect(result.rules).toBe(0)
  expect(result.findings).toEqual([])
  expect([result.cases, result.twins, result.pending, result.inherited]).toEqual([0, 0, 0, 0])
})

test("quotation record scope ends at a peer or ancestor heading, preserving rule source lines", () => {
  for (const heading of ["## Decision", "# Decision"]) {
    const after = quotationRecord + heading + "\n\n`try` must run.\n"
    const line = after.split("\n").indexOf("`try` must run.") + 1
    expect(changedRules([recordChange(after)])).toEqual([
      { path: recordPath, line, text: "`try` must run.", section: "decision" }
    ])
  }
})

test("Amended and Clarified paragraphs remain rules within a quotation section", () => {
  for (const marker of ["Amended", "Clarified"]) {
    for (const prefix of ["", "- ", "* ", "+ ", "1. "]) {
      const amendment = prefix + "**" + marker + " 2026-11-13: emission.** `emit` must preserve values."
      const after = quotationRecord + amendment + "\n\nA `call` must keep its receiver.\n"
      const rules = changedRules([recordChange(after)])
      expect(rules.map(rule => rule.text)).toEqual([
        amendment.replace(/^(?:[-*+] |\d+\. )/, ""), "A `call` must keep its receiver."
      ])
      expect(rules.every(rule => rule.section === "wills-words")).toBe(true)
    }
  }
})

test("a subsequent dated record resumes historical context after a normative amendment", () => {
  const after = quotationRecord + "- **Amended 2026-11-13: emission.** `emit` must preserve values.\n\n" +
    "**2026-11-14: question.**\n\nHe was asked whether `emit` means JavaScript.\n\n" +
    '> "It compiles. This means JavaScript."\n'
  expect(changedRules([recordChange(after)]).map(rule => rule.text)).toEqual(["**Amended 2026-11-13: emission.** `emit` must preserve values."])
})

test("quotation section labels in chapters, examples and comments cannot hide rules", () => {
  for (const fake of [
    "<!-- ## Will's words -->",
    "```md\n## Will's words\n```",
    "## Decision\n\n`## Will's words`",
    "## Will's wording"
  ]) {
    expect(changedRules([recordChange(fake + "\n\n`try` must run.\n")])
      .some(rule => rule.text === "`try` must run.")).toBe(true)
  }
  expect(changedRules([doc("## Will's words\n\n`try` must run.\n")])).toHaveLength(1)
})

test("record context handles nested headings, quoted code and fenced diagrams without swallowing amendments", () => {
  const after = "## Will's words\n\n### Context\n\nHe was shown `try`.\n\n" +
    '> "The `try` form compiles. It means a value."\n\n' +
    "```text\n## Decision\n- **Amended:** `fake` must compile.\n```\n\n" +
    "- **Clarified 2026-11-13: execution.** `try` must run.\n"
  expect(changedRules([recordChange(after)]).map(rule => rule.text)).toEqual(["**Clarified 2026-11-13: execution.** `try` must run."])
})

test("fast-check: historical context is exempt while following amendments and chapters retain evidence", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("try", "match", "schema", "service", "fork"),
    fc.constantFrom("must compile", "is an error", "means a value"),
    fc.constantFrom("Amended", "Clarified"),
    fc.integer({ min: 1000, max: 9999 }),
    async (form, wording, marker, code) => {
      const rule = "The `" + form + "` form " + wording + " (EK" + code + ")."
      const record = "## Will's words\n\n**2026-11-13: question.**\n\nHe was shown `" + form + "`.\n\n" +
        '> "' + rule + ' This compiles."\n\nRecorder\'s reading (not Will\'s words): ' + rule + "\n\n"
      expect((await checkEntry(entry(recordChange(record)), okTwin)).rules).toBe(0)
      const after = record + "- **" + marker + " 2026-11-13: form.** " + rule
      expect((await checkEntry(entry(recordChange(after)), okTwin)).findings.map(f => f.text)).toEqual(["**" + marker + " 2026-11-13: form.** " + rule])
      expect((await checkEntry(entry(doc(record)), okTwin)).findings.length).toBeGreaterThan(0)
    }
  ), { seed: 20261113, numRuns: 100 })
})


test("normative amendment headings in a quotation section retain evidence requirements", () => {
  for (const marker of ["Amended", "Clarified"]) {
    const after = quotationRecord + "### " + marker + "\n\n`try` must run.\n"
    expect(changedRules([recordChange(after)]).map(rule => rule.text)).toEqual(["`try` must run."])
  }
})

test("existing normative VIP amendments beneath the quotation heading remain visible", () => {
  const vip = readFileSync(resolve(import.meta.dir, "../design/vips/0034-compiler-and-tooling.md"), "utf8")
  const rules = changedRules([recordChange(vip)])
  for (const anchor of ["EK4856", "EK3011", "oxfmt file.vibe"])
    expect(rules.some(rule => rule.text.includes(anchor) && rule.section === "wills-words")).toBe(true)
})
