import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test, after } from "node:test"
import { Worker } from "node:worker_threads"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const pending = new Map()
let probeId = 0
let closing = false
const probes = Array.from({ length: 4 }, () => {
  const worker = new Worker(new URL("./testing/api-schema-probe.mjs", import.meta.url))
  worker.on("message", ({ id, value, error, stage, state, elapsedMs }) => {
    if (stage) {
      const job = pending.get(id)
      if (job) job.stage = stage
      console.error("API_SCHEMA_PROBE_STAGE", JSON.stringify({ id, stage, state, elapsedMs }))
      return
    }
    const job = pending.get(id)
    if (!job) return
    pending.delete(id); clearTimeout(job.timer)
    if (error) job.reject(Object.assign(new Error(error.message), error))
    else job.resolve(value)
  })
  const fail = error => {
    if (closing) return
    for (const [id, job] of pending) if (job.worker === worker) {
      pending.delete(id); clearTimeout(job.timer); job.reject(error)
    }
  }
  worker.on("error", fail)
  worker.on("exit", code => fail(new Error("schema probe worker exited " + code)))
  return worker
})
after(async () => { closing = true; await Promise.all(probes.map(worker => worker.terminate())) })
const probe = message => new Promise((resolve, reject) => {
  const id = probeId++, worker = probes[id % probes.length]
  const timer = setTimeout(() => {
    const stage = pending.get(id)?.stage ?? "startup"
    pending.delete(id); reject(new Error("schema compiler probe exceeded its deadline in " + stage)); worker.terminate()
  }, 120_000)
  pending.set(id, { worker, resolve, reject, timer })
  worker.postMessage({ id, ...message })
})
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-schema-mapped-self-copy.json", import.meta.url)))
assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(corpus.rule),
  "the API identity rule must remain quoted from the specification")

const compilerOptions = {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
  exactOptionalPropertyTypes: true, skipLibCheck: false,
  moduleSuffixes: ["", ".d.vibe"], types: [],
}

async function fixture({ count = 17, alias = "Schema", nested = true, extension = ".js", workerValidation = false } = {}, run) {
  const root = mkdtempSync(join(tmpdir(), "api-schema-mapped-"))
  try {
    symlinkSync(resolve("docs/tools/node_modules"), join(root, "node_modules"), "dir")
    const before = join(root, "before"), after = join(root, "after")
    for (const dir of [before, after]) {
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), JSON.stringify({ types: "entry.d.ts" }))
      writeFileSync(join(dir, "entry.d.ts"), dir === after ? corpus.entry.replace("../dep.js", "../dep" + extension) : corpus.entry)
    }
    const fields = Array.from({ length: count - (nested ? 2 : 1) }, (_, i) =>
      `readonly ${corpus.fields[i] ?? "field" + i}: ${alias}.optional<${alias}.Int>`)
    fields.unshift(`readonly required: ${alias}.Int`)
    if (nested) fields.push(`readonly cost: ${alias}.optional<${alias}.Struct<{ readonly amount: ${alias}.Number; readonly currency: ${alias}.decodeTo<${alias}.String, ${alias}.String, never, never> }>>`)
    writeFileSync(join(root, "dep.d.ts"), `import * as ${alias} from "effect/Schema"; export declare const Snapshot: ${alias}.Struct<{${fields.join(";")}}>; export type Snapshot = typeof Snapshot.Type;`)
    const validate = dir => {
      const options = { ...compilerOptions, noEmit: true }
      const program = ts.createProgram([join(dir, "entry.d.ts")], options, ts.createCompilerHost(options))
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [],
        "the authored declaration must be valid before comparison")
    }
    if (!workerValidation) validate(before)
    const compare = () => compareApiIdentity(ts, before, after, {
      compilerOptions, moduleRoots: [join(root, "node_modules")],
    })
    return await run({ root, before, after, compare, validate })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

async function verify(shape) {
  await fixture({ ...shape, workerValidation: true }, async ({ root, before, after }) => {
    await probe({
      kind: "verify", before, after, compilerOptions, moduleRoots: [join(root, "node_modules")],
      changedSource: corpus.entry.replace(/;$/, " & { readonly added: string };")
    })
  })
}

test("copied schema mapped declarations keep reified keyof names in scope", () => verify())

test("unresolved authored schema names keep comparison unavailable", async () => {
  await fixture({}, ({ after, compare }) => {
    writeFileSync(join(after, "entry.d.ts"), corpus.entry.replace("keyof Snapshot", "keyof Missing"))
    const result = compare()
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2304/.test(d.diagnostic)), JSON.stringify(result))
  })
})

test("property: copied schema mapped APIs preserve identity and expose real changes", async () => {
  const sampleCount = process.env.FC_RUNS === undefined ? 12 : Number(process.env.FC_RUNS)
  if ((process.env.FC_RUNS !== undefined && !/^-?\d+$/.test(process.env.FC_RUNS)) ||
      !Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new Error("FC_RUNS must be an integer in [1, " + Number.MAX_SAFE_INTEGER + "]")
  }
  const batchSize = [4, 3, 2, 1].find(size => sampleCount % size === 0)
  await checkProperty(fc, {
    name: "api-identity-schema-mapped-self-copy", generatorVersion: 2,
    rule: corpus.rule,
    command: "node --test scripts/api-identity-schema-mapped.test.mjs",
    arbitrary: fc.array(fc.record({
      count: fc.integer({ min: 16, max: 64 }),
      alias: fc.constantFrom("Schema", "Codec", "S"), nested: fc.boolean(),
      extension: fc.constantFrom(".js", ""),
    }), { minLength: batchSize, maxLength: batchSize }),
    // Twelve independent shapes, grouped across the four available CPUs.
    // Each shape retains both full validations and the same-directory mutation.
    numRuns: sampleCount / batchSize,
    env: { ...process.env, FC_RUNS: String(sampleCount / batchSize) }, check: async shapes => {
      const results = await Promise.allSettled(shapes.map(verify))
      const failure = results.find(result => result.status === "rejected")
      if (failure) throw failure.reason
    },
  })
})
