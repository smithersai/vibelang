import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const options = { compilerOptions: { lib: ["lib.es5.d.ts"] } }
function fixture(before, after, run) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-scale-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) for (const [name, text] of Object.entries(files)) {
      const file = join(root, side, name)
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileSync(file, text)
    }
    return run(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const chain = (depth, leaf) => Array.from({ length: depth }, (_, i) =>
  `interface N${i} { next: N${i + 1} }`).join("\n") +
  `\ninterface N${depth} {\n/** ${leaf} */\nvalue: string\n}\ntype Root = N0;\nexport { Root };`

test("deep exported object chains finish and retain terminal documentation", () => {
  const before = { "index.d.ts": chain(12000, "Terminal documentation") }
  const after = { "index.d.ts": chain(12000, "Changed documentation") }
  fixture(before, after, (a, b) => {
    const same = compareApiIdentity(ts, a, a, options)
    assert.equal(same.identical, true, JSON.stringify(same))
    const changed = compareApiIdentity(ts, a, b, options)
    assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
    assert.equal(changed.identical, false)
    assert.ok(changed.docDifferences.some(d => d.export.endsWith(".value") &&
      d.before === "Terminal documentation" && d.after === "Changed documentation"))
  })
})

test("many exports sharing a deep documented graph do not repeat the documentation walk", () => {
  const text = chain(12000, "Terminal documentation")
    .replace("type Root = N0;\nexport { Root };", "export type Root = N0;")
  fixture({ "index.d.ts": text }, { "index.d.ts": text }, (a, b) => {
    const result = compareApiIdentity(ts, a, b, options)
    assert.equal(result.identical, true, JSON.stringify(result))
  })
})

test("deep error-type walks terminate without hiding a missing exported type", () => {
  for (const used of [false, true]) {
    const files = {
      "index.d.ts": 'import "foreign";\n' + chain(10000, "Terminal").replace("value: string",
        used ? 'value: import("foreign").Broken' : "value: string"),
      "node_modules/foreign/package.json": '{"types":"index.d.ts"}',
      "node_modules/foreign/index.d.ts": "export type Broken = Missing;",
    }
    fixture(files, files, a => {
      const result = compareApiIdentity(ts, a, a, options)
      assert.equal(result.failure, undefined, JSON.stringify(result))
      assert.equal(result.comparisonComplete, !used, JSON.stringify(result))
      assert.equal(result.identical, !used)
      assert.deepEqual(result.typeDifferences, [])
    })
  }
})

const verdict = result => ({
  identical: result.identical, comparisonComplete: result.comparisonComplete,
  nameDifferences: result.nameDifferences,
  typeDifferences: result.typeDifferences.map(({ probe, ...difference }) => difference),
  docDifferences: result.docDifferences,
  environmentDiagnostics: result.environmentDiagnostics,
})
test("property: generated large package verdicts equal small-batch verdicts", async () => {
  await checkProperty(fc, {
    name: "api-identity-large-batch-invariance",
    rule: "Will: exported names, strict bidirectional types and docs are identical regardless of batch size; identical trees report identical",
    command: "node --test scripts/api-identity-scale.test.mjs",
    numRuns: 4,
    arbitrary: fc.record({ modules: fc.integer({ min: 9, max: 12 }), exports: fc.integer({ min: 8, max: 12 }),
      mutation: fc.constantFrom("none", "type", "doc", "name"), value: fc.integer({ min: 1, max: 1000 }) }),
    check: ({ modules, exports, mutation, value }) => {
      const before = {}, after = {}
      for (let m = 0; m < modules; m++) {
        const lines = Array.from({ length: exports }, (_, i) =>
          `/** Export ${m} ${i} */\nexport type X${i}<T = string> = { value: ${value}; item: T };\n`)
        before[`m${m}.d.ts`] = lines.join("")
        if (m === modules - 1) {
          if (mutation === "type") lines[exports - 1] = lines[exports - 1].replace(`value: ${value}`, `value: ${value + 1}`)
          if (mutation === "doc") lines[exports - 1] = lines[exports - 1].replace("Export", "Changed")
          if (mutation === "name") lines[exports - 1] = lines[exports - 1].replace(`X${exports - 1}<`, "Renamed<")
        }
        after[`m${m}.d.ts`] = lines.join("")
      }
      fixture(before, after, (a, b) => {
        const whole = compareApiIdentity(ts, a, b, { ...options, entryBatchSize: 10000, probeBatchSize: 10000 })
        const small = compareApiIdentity(ts, a, b, { ...options, entryBatchSize: 2, probeBatchSize: 7 })
        assert.equal(whole.comparisonComplete, true, JSON.stringify(whole))
        assert.equal(whole.identical, mutation === "none")
        assert.deepEqual(verdict(small), verdict(whole))
        assert.equal(compareApiIdentity(ts, a, a, { ...options, entryBatchSize: 2, probeBatchSize: 7 }).identical, true)
      })
    },
  })
})

test("independent generic entry points fit a bounded heap", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-large-entry-batches.json", import.meta.url)))
  const files = {}
  for (let i = 0; i < corpus.moduleCount; i++) files[`m${i}.d.ts`] =
    `type Tuple<N extends number, T extends unknown[] = []> = T["length"] extends N ? T : Tuple<N, [...T, ${i}]>;
type Assert<T extends true> = T;
type Force = Assert<Tuple<${corpus.tupleDepth}>["length"] extends ${corpus.tupleDepth} ? true : false>;
/** Tuple export ${i} */
export type X = { value: Tuple<${corpus.tupleDepth}>; tag: ${i} };`
  fixture(files, files, (a, b) => {
    const source = `import { readFileSync } from "node:fs";
import { compareApiIdentity, loadTypeScript } from ${JSON.stringify(new URL("./api-identity.mjs", import.meta.url).href)};
const [a, b] = JSON.parse(readFileSync(0, "utf8"));
const result = compareApiIdentity(loadTypeScript(), a, b, { compilerOptions: { lib: ["lib.es5.d.ts"] } });
console.log(JSON.stringify(result));
process.exitCode = result.identical ? 0 : result.comparisonComplete ? 1 : 2;`
    const child = spawnSync(process.execPath, [`--max-old-space-size=${corpus.heapLimitMiB}`, "--input-type=module", "--eval", source], {
      input: JSON.stringify([a, b]), encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert.equal(child.signal, null)
    const result = JSON.parse(child.stdout)
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  })
})

test("input checker state is released before validating generic bridges", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-probe-checker-lifetime.json", import.meta.url)))
  const text = `type Tuple<V, N extends number, T extends unknown[] = []> = T["length"] extends N ? T : Tuple<V, N, [...T, V]>;
type Assert<T extends true> = T;
` + Array.from({ length: corpus.familyCount }, (_, i) =>
    `type Force${i} = Assert<Tuple<${i}, ${corpus.tupleDepth}>["length"] extends ${corpus.tupleDepth} ? true : false>;`).join("\n") +
    "\nexport type Api<T = string> = { item: T };"
  fixture({ "index.d.ts": text }, { "index.d.ts": text }, (a, b) => {
    const source = `import { readFileSync } from "node:fs";
import { compareApiIdentity, loadTypeScript } from ${JSON.stringify(new URL("./api-identity.mjs", import.meta.url).href)};
const [a, b] = JSON.parse(readFileSync(0, "utf8"));
const result = compareApiIdentity(loadTypeScript(), a, b, { compilerOptions: { lib: ["lib.es5.d.ts"] } });
console.log(JSON.stringify(result));
process.exitCode = result.identical ? 0 : result.comparisonComplete ? 1 : 2;`
    const child = spawnSync(process.execPath, [`--max-old-space-size=${corpus.heapLimitMiB}`, "--input-type=module", "--eval", source], {
      input: JSON.stringify([a, b]), encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert.equal(child.signal, null)
    const result = JSON.parse(child.stdout)
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  })
})
