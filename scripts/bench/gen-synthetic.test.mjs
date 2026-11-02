import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { createRequire } from "node:module"
import { checkProperty } from "../testing/property.mjs"

const fc = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))("fast-check")

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const compiler = process.env.VIBELANG_BINARY || path.join(root, "packages/compiler/native/vibelang")
const generator = process.env.SYNTHETIC_GENERATOR || path.join(root, "scripts/bench/gen-synthetic.mjs")
const effect = path.join(root, "experiments/node_modules/effect")
const runtime = path.join(root, "packages/runtime")

test("both synthetic benchmark languages compile and run equivalently across shapes and fan-in boundaries", async (t) => {
  for (const [file, setup] of [
    [compiler, "sh scripts/build-vibelang.sh"],
    [path.join(effect, "package.json"), "(cd experiments && bun install)"],
    [path.join(runtime, "dist/index.d.ts"), "(cd packages/runtime && bun install && bun run build)"],
  ]) {
    if (!fs.existsSync(file)) {
      assert.ok(!process.env.SYNTHETIC_REQUIRE, "missing prerequisite " + file + "; run " + setup)
      return t.skip("missing prerequisite " + file + "; run " + setup)
    }
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-synthetic-test-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const compiledProjects = new Map()
  function verify(shape, count, inputs) {
    const id = shape + "-" + count
    let out = compiledProjects.get(id)
    if (!out) {
      out = path.join(temp, id)
      const generated = spawnSync(process.execPath, [generator, out, String(count), shape], { encoding: "utf8" })
      assert.equal(generated.status, 0, generated.stdout + generated.stderr)
      fs.mkdirSync(path.join(out, "node_modules"), { recursive: true })
      fs.symlinkSync(effect, path.join(out, "node_modules/effect"))
      fs.symlinkSync(runtime, path.join(out, "node_modules/vibelang-runtime"))
      for (const language of ["vibelang", "effect-ts"]) {
        const compiled = spawnSync(compiler, ["-p", path.join(out, language), "--pretty", "false"], {
          encoding: "utf8", timeout: 120_000
        })
        assert.equal(compiled.status, 0, id + "/" + language + "\n" + compiled.stdout + compiled.stderr)
        assert.equal(compiled.stdout + compiled.stderr, "", language + ": benchmark must have zero diagnostics")
      }
      fs.writeFileSync(path.join(out, "probe.mjs"), probe)
      compiledProjects.set(id, out)
    }
    const expected = expectedResults(shape, count, inputs)
    for (const language of ["vibelang", "effect-ts"]) {
      const result = spawnSync(process.execPath, [path.join(out, "probe.mjs"), language, shape, String(count), JSON.stringify(inputs)], {
        encoding: "utf8", timeout: 120_000
      })
      assert.equal(result.status, 0, id + "/" + language + "\n" + result.stdout + result.stderr)
      assert.equal(result.stderr, "")
      assert.deepEqual(JSON.parse(result.stdout), expected, id + "/" + language)
    }
  }
  for (const shape of ["chain", "dense", "single"]) {
    for (const count of [1, 3, 6]) {
      await t.test(shape + "-" + count, () => verify(shape, count, [-1, 0, 1, 3, 4]))
    }
  }
  await t.test("generated module graphs and branch inputs", async () => {
    await checkProperty(fc, {
      name: "synthetic-benchmark-equivalence",
      rule: "docs/maintainers/build.md: synthetic fixtures must compile without diagnostics and return the same values and typed failures",
      command: "node --test scripts/bench/gen-synthetic.test.mjs",
      arbitrary: fc.record({
        shape: fc.constantFrom("chain", "dense", "single"),
        count: fc.integer({ min: 1, max: 7 }),
        inputs: fc.array(fc.integer({ min: -20, max: 20 }), { minLength: 1, maxLength: 5 })
      }),
      numRuns: 12,
      check: ({ shape, count, inputs }) => verify(shape, count, inputs)
    })
  })
})

// Independent arithmetic oracle: k1 is the only stored key. Every other key
// takes the typed Missing catch branch; a dense deep call first loads i - 1.
function expectedResults(shape, count, inputs) {
  const success = (value) => ({ value })
  const missing = (i) => ({ error: "Missing" + i })
  const runs = [0]
  for (let i = 1; i < count; i++) runs[i] = 4 * runs[i - 1] + 4 * i + 24
  const step = (i, n) => (i > 0 && n > 0 ? runs[i - 1] + 2 * n + i - 1 : 0) + (n === 1 ? i + 1 : 0)
  function deep(i, n) {
    if (shape !== "dense" || i === 0) return success(step(i, n))
    if (n !== 1) return missing(i - 1)
    let value = step(i, n) + deep(i - 1, n).value
    for (let j = Math.max(0, i - 4); j < i; j++) value += j + 1
    return success(value)
  }
  return Array.from({ length: count }, (_, i) => ({
    run: success(runs[i]),
    load: [success(i + 1), missing(i)],
    inputs: inputs.map(n => ({ plain: 2 * n + i, step: success(step(i, n)), fanout: success(step(i, n) + step(i, n + 1)), deep: deep(i, n) }))
  }))
}

// Run emitted JavaScript in a real Node process and use the actual pinned
// Effect runtime. The two languages are checked against the oracle separately.
const probe = `
import { Effect, Layer } from "effect"
const [language, shape, textCount, textInputs] = process.argv.slice(2)
const count = Number(textCount), inputs = JSON.parse(textInputs)
const modules = await Promise.all(Array.from({ length: count }, (_, i) => import(new URL(language + "/dist/" + (shape === "single" ? "all" : "m" + i) + ".js", import.meta.url))))
const services = Layer.mergeAll(...modules.map((m, i) => m["Store" + i + "Live"]))
const run = (effect) => Effect.runPromise(Effect.match(Effect.provide(effect, services), {
  onSuccess: value => ({ value }), onFailure: error => ({ error: error._tag })
}))
const results = []
for (let i = 0; i < count; i++) {
  const m = modules[i], rows = []
  for (const n of inputs) rows.push({
    plain: m["plain" + i](n), step: await run(m["step" + i](n)),
    fanout: await run(m["fanout" + i](n)), deep: await run(m["deep" + i](n))
  })
  results.push({ run: await run(m["run" + i]()), load: [await run(m["load" + i]("k1")), await run(m["load" + i]("absent"))], inputs: rows })
}
console.log(JSON.stringify(results))
`
