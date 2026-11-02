import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import { block, read, run } from "./spec-witness.mjs"

// Loop round 5, OPUS-4 (decided detail 254): EK4834, EK4835 and EK4836 said
// "explicitly run" without a definition, and 002's own EK0505 quick fix,
// fork Effect.catch(e, h), read as an EK4835 with no repair. The rows now
// name one consumer: the direct operand of bare try in effect code.

const codes = ["EK4834", "EK4835", "EK4836"]
const direct = "as the direct operand of bare `try` in effect code"

test("the three rows in 007 and Appendix B name the direct try operand", () => {
  for (const file of ["docs/design/src/007-tooling.md", "docs/design/src/900-appendices.md"]) {
    const lines = read(file).split("\n")
    for (const code of codes) {
      const row = lines.find(l => l.startsWith(`| \`${code}\` |`))
      assert.ok(row, `${file} ${code}`)
      assert.ok(row.includes(direct), `${file} ${code}: ${row}`)
    }
  }
})

test("007 lists the consumers that do not warn and ties fork Effect.catch to 002", () => {
  const text = read("docs/design/src/007-tooling.md")
  assert.ok(text.includes("In the `EK4834`, `EK4835` and `EK4836` rows, the call is the direct operand of bare `try` in effect code."))
  assert.ok(text.includes("An operand of `fork` in any form, of `join`, of `try.all`, `try.race`, `try.any` or `try.allSettled` or one of its elements, an argument of an Effect API, the head of a `catch`, and a stored or returned Effect are not direct operands, and these rows do not warn on them"))
  assert.ok(text.includes("`fork Effect.catch(e, h)` keeps recovery in the child ([`fork` and `join`](002-running.md#fork-and-join))"))
  assert.match(text, /const child = fork Effect\.catch\(e, h\) +\/\/ no EK4835/)
  // 002's EK0505 quick fix is the form the rows exempt.
  assert.ok(read("docs/design/src/002-running.md").includes("`fork Effect.catch(e, h)`"))
})

const pages = dir => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true }).filter(f => f.endsWith(".md")).map(f => `${dir}/${f}`)

test("no chapter or user page keeps the undefined words", () => {
  const hits = []
  // The release notes quote the old words to say what changed.
  for (const file of [...pages("docs/design/src"), ...pages("docs/user/src")].filter(f => !f.endsWith("release-notes.md"))) {
    if (read(file).includes("explicitly run")) hits.push(file)
  }
  assert.deepEqual(hits, [])
})

test("the user guide's EK4835 and EK4836 sources are direct try operands", () => {
  const lines = read("docs/user/src/getting-started/012-devtools.md").split("\n")
  for (const code of codes) {
    const row = lines.find(l => l.startsWith(`| ${code} |`) || l.startsWith(`| \`${code}\` |`))
    const source = row.split("|")[2]
    // Detail 254 governs these calls; another span in a row, such as
    // EK4836's Effect.withSpan, follows its own trigger.
    const governed = source.match(/`[^`]+`/g).filter(span => /Effect\.(succeed|fail|catch|catchTag|catchTags|provide|provideService)\(/.test(span))
    assert.ok(governed.length > 0, `${code}: ${row}`)
    for (const span of governed) assert.match(span, /^`(return )?try Effect\./, `${code}: ${span}`)
  }
})

// PREVIEW-8: the advisory example's TypeScript reference is its counterpart.
// Translate the VibeLang demo statement by statement with chapter 2's own
// counterparts (`try x`, `fork x` as `Effect.forkChild(x)`, `try.all [..]` as
// `Effect.all([..], { concurrency: "unbounded" })`), run that translation and
// the published reference on the same inputs, and compare their Exits. The
// harness observes the two child fibers from outside demo.
const tooling = () => read("docs/design/src/007-tooling.md")

function translate(source) {
  const out = ['import { Effect } from "effect"']
  for (const line of source.split("\n").map(l => l.replace(/\s*\/\/.*$/, "")).filter(l => l.trim())) {
    let m
    if (/^effect function demo\(/.test(line)) out.push("function demo(e: any, h: any) {", "  return Effect.gen(function* () {")
    else if ((m = line.match(/^ {2}const (\w+) = try\.all \[(.*)\]$/))) out.push(`    const ${m[1]} = yield* Effect.all([${m[2]}], { concurrency: "unbounded" })`)
    else if ((m = line.match(/^ {2}const (\w+) = try (.*)$/))) out.push(`    const ${m[1]} = yield* ${m[2]}`)
    else if ((m = line.match(/^ {2}const (\w+) = fork (.*)$/))) out.push(`    const ${m[1]} = yield* Effect.forkChild(${m[2]})`)
    else if ((m = line.match(/^ {2}return (.*)$/))) out.push(`    return ${m[1]}`)
    else if (line === "}") out.push("  })", "}")
    else throw new Error(`the test has no counterpart for: ${line}`)
  }
  return out.join("\n") + "\n"
}

const harness = `
import { Effect as $Effect, Exit as $Exit, Fiber as $Fiber } from "effect"
const $show = (exit: any) => $Exit.isSuccess(exit)
  ? { success: exit.value }
  : { failure: exit.cause.reasons.map((r: any) => r._tag === "Fail" ? ["Fail", r.error] : [r._tag]) }
const $observe = (e: any) => $Effect.gen(function* () {
  const exit: any = yield* $Effect.exit(demo(e, (_: string) => $Effect.succeed(7)))
  if ($Exit.isFailure(exit)) return $show(exit)
  const [child, failedChild, both] = exit.value
  return { success: [$show(yield* $Fiber.await(child)), $show(yield* $Fiber.await(failedChild)), both] }
})
console.log(JSON.stringify(await $Effect.runPromise($Effect.all([$observe($Effect.fail("e")), $observe($Effect.succeed(2))]))))
`

function exits(program) {
  const result = run(program + harness)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout.trim().split("\n").at(-1))
}

test("the advisory example's TypeScript reference ends with the VibeLang demo's Exit", () => {
  const text = tooling()
  const source = block(text, "effect function demo(", "vibe es")
  const reference = block(text, "function demo(e: Effect.Effect<")
  const expected = exits(translate(source))
  // A failing e fails demo at try.all; a succeeding one lets demo inspect
  // both children: the recovered child and the child that failed with "boom".
  assert.deepEqual(expected, [
    { failure: [["Fail", "e"]] },
    { success: [{ success: 2 }, { failure: [["Fail", "boom"]] }, [1, 2]] }
  ])
  assert.deepEqual(exits(reference), expected)
})
