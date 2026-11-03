import assert from "node:assert/strict"
import { readFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { parseStyleTree, preservedGlobalErrors } from "../lib/preserved-errors.mjs"
import { parseDiagnostics, styleProblems } from "../lib/diagnostics.mjs"
import { compile, makeConfig, paths } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-websocket-returned-pipe-error.json", import.meta.url)))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const marker = 'throw new Error("Connection timeout")'
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
  return parseDiagnostics(result.stdout + result.stderr)
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
    const diagnostics = checkType(root, "after.vibe", c.after, c.ref, "Effect", "readonly [number, Error, never]", c.key + ":" + c.name)
    const at = c.after.indexOf(marker), lines = c.after.slice(0, at).split("\n")
    assert.ok(at >= 0)
    const d = { file: "main.vibe", line: lines.length, column: lines.at(-1).length + 1, code: "EK4804", category: "warning", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by." }
    const [oldTree, newTree] = await Promise.all([parseStyleTree(compiler, "main.ts", c.before), parseStyleTree(compiler, "main.vibe", c.after)])
    const result = preservedGlobalErrors(oldTree, newTree, c.after, [d])
    assert.equal(result.decisions.length, 1)
    if (safe.includes(c.profile) || c.profile === "direct") {
      const warnings = diagnostics.filter(d => d.code === "EK4804")
      assert.ok(warnings.length > 0, "actual native advisory")
      const actual = preservedGlobalErrors(oldTree, newTree, c.after, warnings)
      assert.equal(actual.accepted.size, warnings.length, JSON.stringify(actual.decisions))
      assert.deepEqual(styleProblems(diagnostics, ["after.vibe"], actual.accepted), [])
    }
    if (safe.includes(c.profile)) {
      assert.equal(result.decisions[0].function, c.ref)
      assert.equal(result.decisions[0].channel, "Error")
      assert.equal(result.accepted.size, 1, c.key)
    } else {
      assert.equal(result.accepted.size, c.profile === "direct" ? 1 : 0, JSON.stringify({ case: c.key, decisions: result.decisions }))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-117: literal returned timeout/catchTag callback channel preserves the original contract", async () => {
  const c = scenario("timeout-catchTag")
  c.before = corpus.before
  await verify(c)
})

test("returned-pipe contracts distinguish direct, erased, remapped, discarded, Promise and iterator results", async () => {
  for (const home of ["top", "object", "nested"])
    for (const profile of ["direct", "erase", "remap", "discard", "async", "generator"]) await verify(scenario(profile, "expression", "named", "acquire", home))
})

test("each returned pipe shape has a typed native reference", async () => {
  for (const row of corpus.cases) {
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
    { seed: 1172602, numRuns: 100 })
})


// Inbox 13:17Z census: four pipe profiles x two aliases x two return bodies
// x two E channels = 32 preserving models, with 22 direct/refusal controls.
const censusProfiles = {
  map: "Effect.map(n => n + 1)",
  tap: "Effect.tap(() => {})",
  timeout: 'Effect.timeout("5 seconds")',
  original: 'Effect.timeout("5 seconds"), Effect.catchTag("TimeoutError", () => Effect.fail(new Error("timeout")))'
}
async function decideSource(before, channel = "Error", afterOverride) {
  const after = afterOverride ?? `export const acquire = effect (): number!${channel} => { ${marker}; }`
  const offset = after.indexOf(marker), lines = after.slice(0, offset).split("\n")
  const diagnostic = { file: "main.vibe", line: lines.length, column: lines.at(-1).length + 1,
    code: "EK4804", category: "warning", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by." }
  const result = preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", before),
    await parseStyleTree(compiler, "main.vibe", after), after, [diagnostic])
  return result
}
const callback = channel => `Effect.callback<number, ${channel}>(() => {})`
const imported = 'import { Effect } from "effect";\n'

test("foldkit-117 inbox neighbourhood: 32 preserving pipes and 22 controls", async () => {
  let preserving = 0, controls = 0
  for (const stages of Object.values(censusProfiles))
    for (const alias of ["Effect", "Fx"])
      for (const block of [false, true])
        for (const channel of ["Error", "Error | OtherError"]) {
          const expression = callback(channel) + ".pipe(" + stages + ")"
          const before = (imported + "export const acquire = () => " +
            (block ? "{ return " + expression + "; }" : expression)).replaceAll("Effect", alias)
            .replace('import { Fx }', 'import { Effect as Fx }')
          const result = await decideSource(before, channel)
          assert.equal(result.accepted.size, 1, JSON.stringify({ before, decisions: result.decisions }))
          preserving++
        }
  for (const channel of ["Error", "Error | OtherError"]) {
    const direct = callback(channel), piped = direct + ".pipe(" + censusProfiles.original + ")"
    const variants = [
      ["() => " + direct, true],
      ["() => { return " + direct + "; }", true],
      ["() => () => " + piped, false],
      ["() => { " + piped + "; return Effect.succeed(1); }", false],
      ["async () => " + piped, false],
      ["function* () { return " + piped + "; }", false],
      ["async function* () { return " + piped + "; }", false],
      ["() => " + direct + ".pipe(Effect.mapError(() => new OtherError()))", false],
      ["() => " + direct + ".pipe(Effect.catch(() => Effect.succeed(1)))", false],
      ["(): Promise<unknown> => " + piped, false],
      ["(): Iterable<unknown> => " + piped, false]
    ]
    for (const [producer, keep] of variants) {
      const result = await decideSource(imported + "export const acquire = " + producer, channel)
      assert.equal(result.accepted.size, keep ? 1 : 0, producer)
      controls++
    }
  }
  assert.equal(preserving, 32)
  assert.equal(controls, 22)
})

test("unproved pipe stages and extra wrappers never supply a callback contract", async () => {
  const direct = callback("Error")
  for (const expression of [
    direct + ".pipe(unknown)",
    direct + ".pipe(Effect.flatMap(() => Effect.fail(new OtherError())))",
    direct + ".pipe(Effect.tap(() => Effect.fail(new OtherError())))",
    direct + ".pipe(Effect.tap(async () => {}))",
    direct + ".pipe(Effect.tap(function* () {}))",
    direct + '.pipe(Effect.timeout({ duration: "1 second", onTimeout: () => new OtherError() }))',
    direct + '.pipe(Effect.catchTag("TimeoutError", () => Effect.fail(new OtherError())))',
    direct + '.pipe(Effect.catchTag("TimeoutError", () => Effect.succeed(1)))',
    direct + '.pipe(Effect.catchTag("OtherError", () => Effect.fail(new Error())))',
    direct + '.pipe(Effect.catchTag("TimeoutError", async () => Effect.fail(new Error())))',
    direct + ".pipe(...stages)",
    direct + '.pipe(Effect.map(n => n)).pipe(Effect.as(1))',
    "wrap(" + direct + ".pipe(Effect.as(1)))",
    "(" + direct + ".pipe(Effect.as(1)) as Effect.Effect<number, Error>)"
  ]) {
    const result = await decideSource(imported + "export const acquire = () => " + expression)
    assert.equal(result.accepted.size, 0, expression)
  }
})

test("generated pipe stages keep exact channels and function boundaries", async () => {
  // migrate/rules.md: declarations must be identical. Unknown/error-changing
  // operators are intentionally refused; a generic E is not a pipeline type.
  await fc.assert(fc.asyncProperty(
    fc.array(fc.constantFrom(...Object.values(censusProfiles), "Effect.as(1)", "Effect.tap(() => void 0)"), { minLength: 1, maxLength: 5 }),
    fc.constantFrom("Error", "Error | OtherError"), fc.boolean(),
    fc.constantFrom("plain", "async", "generator", "nested", "discarded"),
    fc.boolean(), async (stages, channel, changed, kind, unsafe) => {
      if (unsafe) stages.push("Effect.mapError(() => new OtherError())")
      const expression = callback(channel) + ".pipe(" + stages.join(", ") + ")"
      const producer = kind === "async" ? "async () => " + expression
        : kind === "generator" ? "function* () { return " + expression + "; }"
        : kind === "nested" ? "() => () => " + expression
        : kind === "discarded" ? "() => { " + expression + "; return Effect.succeed(1); }"
        : "() => " + expression
      const result = await decideSource(imported + "export const acquire = " + producer, changed ? "Error | DifferentError" : channel)
      assert.equal(result.accepted.size, !changed && !unsafe && kind === "plain" ? 1 : 0,
        JSON.stringify({ stages, channel, changed, kind, unsafe, decisions: result.decisions }))
    }), { seed: 1172603, numRuns: 160 })
})


test("foldkit-117: compile retains the journaled callback pipe's actual advisory", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-pipe-flow-"))
  const target = join(root, "repo"), run = join(root, "run")
  try {
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    symlinkSync(dirname(require.resolve("effect/package.json")), join(target, "node_modules/effect"))
    symlinkSync(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)), join(target, "node_modules/vibelang-runtime"))
    symlinkSync(compiler, join(target, "node_modules/.bin/vibelang"))
    writeJson(join(target, "package.json"), { type: "module" })
    writeJson(join(target, "tsconfig.json"), { compilerOptions: { module: "NodeNext", target: "ES2022", strict: true, skipLibCheck: true, types: [] }, files: ["main.vibe"] })
    writeFileSync(join(target, "main.vibe"), scenario("timeout-catchTag").after)
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: ["main.ts"] }] })
    writeJson(join(p.baseline, "compile-root.json"), [])
    writeJson(p.codemodState("01"), { version: 1, phase: "fixing", files: ["main.ts"],
      renames: [{ from: "main.ts", to: "main.vibe" }],
      originals: [{ from: "main.ts", to: "main.vibe", bytes: Buffer.from(corpus.before).toString("base64"), mode: 0o644 }],
      writes: [], attempts: [] })
    const result = await compile({ run, batch: "01" })
    assert.ok(result.diagnostics.some(d => d.code === "EK4804"), "retain actual compiler advisory")
    assert.deepEqual(result.style, [])
    assert.ok(result.styleExemptions.some(d => d.exempt && d.oracle === "source" && /returned callback/.test(d.reason)),
      JSON.stringify(result.styleExemptions))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
