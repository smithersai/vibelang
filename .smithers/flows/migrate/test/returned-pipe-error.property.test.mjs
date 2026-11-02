import assert from "node:assert/strict"
import { readFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { parseStyleTree, preservedGlobalErrors } from "../lib/preserved-errors.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-websocket-returned-pipe-error.json", import.meta.url)))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const marker = 'throw new Error("Connection timeout")'
const pending = new Map(corpus.pending.map(row => [row.key, row.owner]))
const raw = process.env.VIBELANG_RETURNED_PIPE_RAW === "1"
const safe = ["timeout-catchTag", "map", "as"]

function scenario(profile, wrapper = "expression", style = "named", name = "acquire", home = "top") {
  const alias = style === "named" ? "Effect" : "Fx"
  const imported = style === "namespace" ? 'import * as Fx from "effect/Effect"' : style === "alias" ? 'import { Effect as Fx } from "effect"' : 'import { Effect } from "effect"'
  let call = `${alias}.callback<number, Error>(() => {})`
  const operations = {
    "timeout-catchTag": `${alias}.timeout("5 seconds"), ${alias}.catchTag("TimeoutError", () => ${alias}.fail(new Error("Connection timeout")))`,
    map: `${alias}.map(n => n + 1)`, as: `${alias}.as(1 + 0)`,
    erase: `${alias}.catch(() => ${alias}.succeed(1))`,
    remap: `${alias}.mapError(() => ({ _tag: "Other" as const }))`
  }
  if (operations[profile]) call += `.pipe(${operations[profile]})`
  let producer = wrapper === "block" ? `() => { return ${call}; }` : wrapper === "parenthesized" ? `() => ((${call}))` : `() => ${call}`
  if (profile === "discard") producer = `() => { ${call}; return ${alias}.succeed(1); }`
  if (profile === "async") producer = `async () => ${call}`
  if (profile === "generator") producer = `function* () { return ${call}; }`
  const emit = body => home === "object" ? `export const resource = { ${name}: ${body} }` : home === "nested" ? `export const resource = { inner: { ${name}: ${body} } }` : `export const ${name} = ${body}`
  const ref = home === "object" ? `resource.${name}` : home === "nested" ? `resource.inner.${name}` : name
  const before = `${imported}\n${emit(producer)}\n`
  const after = `import { Effect } from "effect"\n${emit(`effect (): number!Error => { ${marker}; }`)}\n`
  return { profile, wrapper, style, name, home, ref, alias, before, after,
    expected: ["async", "generator"].includes(profile) ? '"__not_effect"' : `readonly [number, ${["erase", "discard"].includes(profile) ? "never" : profile === "remap" ? "Other" : "Error"}, never]`,
    key: `preserved-errors:returned-callback-pipe:${profile}:${wrapper}:${style}:${home}` }
}

function checkType(root, file, source, name, alias, expected, context) {
  const proof = `\ntype Other = { _tag: "Other" };\ntype __Shape<T> = T extends ${alias}.Effect<infer A, infer E, infer R> ? readonly [A, E, R] : "__not_effect";\ntype __Equal<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;\ntype __Check<T extends true> = T;\ntype __Contract = __Check<__Equal<__Shape<ReturnType<typeof ${name}>>, ${expected}>>;\n`
  writeFileSync(join(root, file), source + proof)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", target: "ES2022", strict: true, skipLibCheck: true, noEmit: true, types: [] }, files: [file] }))
  const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
  assert.equal(result.status, 0, context + " " + file + " expected " + expected + " contract proof:\n" + result.stdout + result.stderr + "\nsource:\n" + source)
}

async function verify(c) {
  assert.ok(existsSync(compiler), "build the native compiler")
  const root = mkdtempSync(join(tmpdir(), "foldkit-returned-pipe-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(require.resolve("effect/package.json")), join(root, "node_modules/effect"))
    symlinkSync(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)), join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    // Independent compiler type assertions pin A/E/R, including the negative
    // controls where a pipe erases/remaps E or a wrapper returns a non-Effect.
    checkType(root, "before.ts", c.before, c.ref, c.alias, c.expected, c.key + ":" + c.name)
    checkType(root, "after.vibe", c.after, c.ref, "Effect", "readonly [number, Error, never]", c.key + ":" + c.name)
    const at = c.after.indexOf(marker), lines = c.after.slice(0, at).split("\n")
    assert.ok(at >= 0)
    const d = { file: "main.vibe", line: lines.length, column: lines.at(-1).length + 1, code: "EK4804", category: "warning", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by." }
    const [oldTree, newTree] = await Promise.all([parseStyleTree(compiler, "main.ts", c.before), parseStyleTree(compiler, "main.vibe", c.after)])
    const result = preservedGlobalErrors(oldTree, newTree, c.after, [d])
    assert.equal(result.decisions.length, 1)
    if (safe.includes(c.profile)) {
      const owner = pending.get(c.key)
      assert.equal(result.decisions[0].function, c.ref)
      assert.equal(result.decisions[0].channel, "Error")
      if (raw || !owner) { assert.equal(result.accepted.size, 1, c.key); return }
      assert.equal(owner, "migflow-foldkit", c.key + ": precise pending owner")
      assert.equal(result.accepted.size, 0, c.key + ": XPASS; retire this exact pending key")
      assert.equal(result.decisions[0].reason, "no matching explicit global Error channel", c.key)
    } else {
      assert.equal(result.accepted.size, c.profile === "direct" ? 1 : 0, JSON.stringify({ case: c.key, decisions: result.decisions }))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-117: literal returned timeout/catchTag callback channel remains owner-pending", async () => {
  const c = scenario("timeout-catchTag")
  c.before = corpus.before
  await verify(c)
})

test("returned-pipe contracts distinguish direct, erased, remapped, discarded, Promise and iterator results", async () => {
  for (const home of ["top", "object", "nested"])
    for (const profile of ["direct", "erase", "remap", "discard", "async", "generator"]) await verify(scenario(profile, "expression", "named", "acquire", home))
})

test("each pending pipe shape has a typed native reference and retires on XPASS", async () => {
  for (const row of corpus.pending) {
    const c = scenario(row.profile, row.wrapper, row.style, "acquire", row.home)
    assert.equal(c.key, row.key)
    await verify(c)
  }
})

test("generated returned callback pipes retain their own typed channel and wrapper boundary", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("direct", ...safe, "erase", "remap", "discard", "async", "generator"),
    fc.constantFrom("expression", "block", "parenthesized"), fc.constantFrom("named", "alias", "namespace"),
    fc.constantFrom("acquire", "open", "connect"), fc.constantFrom("top", "object", "nested"),
    async (profile, wrapper, style, name, home) => verify(scenario(profile, wrapper, style, name, home))),
    { seed: 1172602, numRuns: raw ? 1 : 48, endOnFailure: raw })
})
