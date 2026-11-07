import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { referenceRefreshPlan, refreshProjectReferences } from "../lib/reference-outputs.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-dependent-project-outputs.json", import.meta.url)))
const baseConfig = JSON.parse(readFileSync(new URL("./corpus/alchemy-reference-refresh-base-config-outputs.json", import.meta.url)))

function fixture(count = 3) {
  const root = mkdtempSync(join(tmpdir(), "reference-outputs-"))
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
  }
  put("base.json", { compilerOptions: { composite: true, declaration: true, target: "ESNext", module: "ESNext" } })
  const configs = []
  for (let i = 0; i < count; i++) {
    const name = "p" + i
    configs.push(name + "/tsconfig.json")
    put(configs.at(-1), { extends: "../base.json", compilerOptions: {
      rootDir: "src", outDir: "lib", declarationDir: "types", tsBuildInfoFile: "cache/build.tsbuildinfo" },
      include: ["src"], references: i ? [{ path: "../p" + (i - 1) }] : [] })
    put(name + "/src/main.ts", "export const value = 1\n")
    for (const output of corpus.outputs) put(name + "/" + output, "stale")
  }
  return { root, put, configs, close: () => rmSync(root, { recursive: true, force: true }) }
}

test("renames and reverts clear effective outputs through reverse project references", async () => {
  const f = fixture()
  try {
    for (const extension of ["vibe", "ts"]) {
      rmSync(join(f.root, "p0/src/main.ts"), { force: true })
      rmSync(join(f.root, "p0/src/main.vibe"), { force: true })
      f.put("p0/src/main." + extension, "export const value = 2\n")
      let calls = 0
      const receipt = await refreshProjectReferences({ ...f, ts, changed: ["p0/src/main." + extension],
        compiler: "vibelang", log: join(f.root, "refresh.log"), execute: async (command) => {
          calls++
          for (let i = 0; i < 3; i++) for (const output of corpus.outputs) assert.equal(existsSync(join(f.root, "p" + i, output)), false)
          assert.match(command, /--build --force --pretty false 'p2\/tsconfig.json'/)
          assert.equal(JSON.parse(readFileSync(join(f.root, "refresh.log.json"))).state, "outputs-cleared")
          return { code: 0, stdout: "", stderr: "" }
        } })
      assert.equal(calls, 1)
      assert.equal(receipt.state, "complete")
      assert.deepEqual(receipt.projects, f.configs)
      assert.equal(existsSync(join(f.root, "p0/src/main." + extension)), true)
    }
  } finally { f.close() }
})

test("reference invalidation follows generated chain lengths and changed owners", () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 7 }), fc.nat(), (count, index) => {
    const f = fixture(count)
    try {
      index %= count
      const plan = referenceRefreshPlan({ ...f, ts, changed: ["p" + index + "/src/main.ts"] })
      assert.deepEqual(plan.projects, f.configs.slice(index))
      assert.deepEqual(plan.roots, [f.configs.at(-1)])
      assert.equal(plan.outputs.length, 3 * (count - index))
    } finally { f.close() }
  }), { numRuns: 30 })
})

// A root config that only shares options, with allowJs and no include, lists
// every emitted file through TypeScript's default include. It takes no part in
// the refresh, and the repository does not track those outputs, so its listing
// protects none of them; a tracked file or an untracked TypeScript source there
// still refuses the plan.
function withBaseConfig(f) {
  f.put("tsconfig.base.json", baseConfig.base)
  for (const output of baseConfig.outputs) f.put("p0/" + output, "stale")
  const tracked = [...f.configs, "base.json", "tsconfig.base.json", ...f.configs.map(config => config.replace("tsconfig.json", "src/main.ts"))]
  return { configs: [...f.configs, "tsconfig.base.json"], tracked }
}

test("alchemy-base-config: an unrelated default-include config protects no untracked output", () => {
  const f = fixture(2)
  try {
    const { configs, tracked } = withBaseConfig(f)
    const changed = ["p0/src/main.ts"]
    const plan = referenceRefreshPlan({ ...f, ts, configs, changed, tracked })
    assert.deepEqual(plan, referenceRefreshPlan({ ...f, ts, changed, tracked }))
    assert.ok(plan.outputs.includes("p0/lib") && plan.outputs.includes("p1/lib"))
    for (const { file, tracked: kept } of baseConfig.protected) {
      f.put("p0/" + file, "export const kept = 1\n")
      assert.throws(() => referenceRefreshPlan({ ...f, ts, configs, changed, tracked: kept ? [...tracked, "p0/" + file] : tracked }),
        error => /unsafe project output: p0\/lib/.test(error.message) && error.details.protectedSources.includes("p0/" + file))
      rmSync(join(f.root, "p0/" + file))
    }
    // Without the repository's tracked files, every listed file stays protected.
    assert.throws(() => referenceRefreshPlan({ ...f, ts, configs, changed }), /unsafe project output: p0\/lib/)
  } finally { f.close() }
})

test("an unrelated config's listing of untracked outputs never changes the refresh plan", () => {
  // The base-config corpus over generated chains, changed owners, base configs
  // with or without allowJs and include, and output names a build writes.
  fc.assert(fc.property(fc.integer({ min: 2, max: 5 }), fc.nat(), fc.boolean(), fc.constantFrom("default", "all", "packages"),
    fc.subarray(baseConfig.outputs, { minLength: 1 }), fc.constantFrom("none", "tracked", "source"),
    (count, index, allowJs, include, outputs, extra) => {
      const f = fixture(count)
      try {
        index %= count
        const base = { ...baseConfig.base, compilerOptions: { ...baseConfig.base.compilerOptions, allowJs },
          ...(include === "all" ? { include: ["**/*"] } : include === "packages" ? { include: ["p*/**/*"] } : {}) }
        f.put("tsconfig.base.json", base)
        for (let i = 0; i < count; i++) for (const output of outputs) f.put("p" + i + "/" + output, "stale")
        const tracked = [...f.configs, "base.json", "tsconfig.base.json", ...f.configs.map(config => config.replace("tsconfig.json", "src/main.ts"))]
        const configs = [...f.configs, "tsconfig.base.json"], changed = ["p" + index + "/src/main.ts"]
        if (extra === "none") {
          const plan = referenceRefreshPlan({ ...f, ts, configs, changed, tracked })
          assert.deepEqual(plan, referenceRefreshPlan({ ...f, ts, changed, tracked }))
          assert.deepEqual(plan.projects, f.configs.slice(index))
          return
        }
        // The chain's last project is always rebuilt.
        const file = "p" + (count - 1) + "/lib/" + (extra === "tracked" ? "kept.js" : "generated.ts")
        f.put(file, "export const kept = 1\n")
        assert.throws(() => referenceRefreshPlan({ ...f, ts, configs, changed, tracked: extra === "tracked" ? [...tracked, file] : tracked }),
          error => error.message === "unsafe project output: p" + (count - 1) + "/lib")
      } finally { f.close() }
    }), { numRuns: 60 })
})

test("unsafe effective output directories are refused before any deletion", async () => {
  const f = fixture()
  try {
    f.put("p1/tsconfig.json", { extends: "../base.json", compilerOptions: { outDir: "../", declarationDir: "types" },
      files: ["src/main.ts"], references: [{ path: "../p0" }] })
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: ["p0/src/main.ts"],
      compiler: "vibelang", log: join(f.root, "refresh.log") }), /unsafe project output/)
    assert.equal(existsSync(join(f.root, "p0/lib/main.js")), true)
  } finally { f.close() }
})

test("independent source projects preserve their existing outputs", () => {
  const f = fixture(1)
  try { assert.deepEqual(referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] }), { projects: [], roots: [], outputs: [] }) }
  finally { f.close() }
})

test("inherited output paths and default build-info names are effective project inputs", () => {
  const f = fixture(2)
  try {
    f.put("p0/options.json", { extends: "../base.json", compilerOptions: { rootDir: "src", outDir: "compiled", declarationDir: "declarations" } })
    f.put("p0/tsconfig.json", { extends: "./options.json", include: ["src"] })
    const plan = referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] })
    assert.ok(plan.outputs.includes("p0/compiled"))
    assert.ok(plan.outputs.includes("p0/declarations"))
    assert.ok(plan.outputs.includes("p0/tsconfig.tsbuildinfo"))
  } finally { f.close() }
})

test("failed rebuilds remain failed in the durable progress receipt", async () => {
  const f = fixture(2)
  try {
    const log = join(f.root, "failed.log")
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: ["p0/src/main.ts"], compiler: "vibelang", log,
      execute: async () => ({ code: 1, stdout: "error TS6305: referenced output missing\n", stderr: "" }) }), /reference rebuild failed/)
    assert.equal(JSON.parse(readFileSync(log + ".json")).state, "failed")
  } finally { f.close() }
})

const generatedConfig = JSON.parse(readFileSync(new URL("./corpus/alchemy-unrelated-generated-reference-config.json", import.meta.url)))
function addGeneratedConfig(f, references = []) {
  f.put(generatedConfig.unrelatedConfig, { extends: generatedConfig.unavailableExtends,
    files: ["src/main.ts"], references })
  f.put(generatedConfig.source, "export const unused = 1\n")
  f.put("unused/lib/main.js", "keep")
  f.configs.push(generatedConfig.unrelatedConfig)
}

test("unrelated generated configurations do not block reference refresh after a return", async () => {
  const f = fixture()
  try {
    const expected = referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] })
    addGeneratedConfig(f)
    assert.deepEqual(referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] }), expected)
    let calls = 0
    const receipt = await refreshProjectReferences({ ...f, ts, changed: ["p0/src/main.ts"],
      compiler: "vibelang", log: join(f.root, "generated.log"), execute: async () => {
        calls++
        assert.equal(readFileSync(join(f.root, "unused/lib/main.js"), "utf8"), "keep")
        return { code: 0, stdout: "", stderr: "" }
      } })
    assert.equal(calls, 1)
    assert.equal(receipt.state, "complete")
    assert.deepEqual(receipt.projects, ["p0/tsconfig.json", "p1/tsconfig.json", "p2/tsconfig.json"])
  } finally { f.close() }
})

test("changed invalid configurations name their owner and diagnostic before deletion", async () => {
  const f = fixture()
  try {
    addGeneratedConfig(f)
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: [generatedConfig.source],
      compiler: "vibelang", log: join(f.root, "changed-invalid.log"),
      execute: async () => assert.fail("invalid project must not execute") }), error =>
      error.message.includes(generatedConfig.unrelatedConfig) && /TS6053/.test(error.message))
    assert.equal(readFileSync(join(f.root, "unused/lib/main.js"), "utf8"), "keep")
    assert.equal(readFileSync(join(f.root, "p0/lib/main.js"), "utf8"), "stale")
  } finally { f.close() }
})

test("invalid reverse dependents still fail planning and identify their configuration", () => {
  const f = fixture()
  try {
    addGeneratedConfig(f, [{ path: "../p1" }])
    assert.throws(() => referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] }), error =>
      error.message.includes(generatedConfig.unrelatedConfig) && /TS6053/.test(error.message))
    assert.equal(readFileSync(join(f.root, "p0/lib/main.js"), "utf8"), "stale")
  } finally { f.close() }
})

test("invalid forward dependencies fail before an affected output is cleared", async () => {
  const f = fixture()
  try {
    f.put("p0/tsconfig.json", { extends: generatedConfig.unavailableExtends,
      compilerOptions: { composite: true }, files: ["src/main.ts"] })
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: ["p2/src/main.ts"],
      compiler: "vibelang", log: join(f.root, "invalid-dependency.log"),
      execute: async () => assert.fail("invalid dependency must not execute") }), error =>
      error.message.includes("p0/tsconfig.json") && /TS6053/.test(error.message))
    assert.equal(readFileSync(join(f.root, "p2/lib/main.js"), "utf8"), "stale")
  } finally { f.close() }
})

test("malformed configurations fail closed with a named diagnostic", () => {
  const f = fixture()
  try {
    f.put("broken/tsconfig.json", "{")
    f.configs.push("broken/tsconfig.json")
    assert.throws(() => referenceRefreshPlan({ ...f, ts, changed: ["p0/src/main.ts"] }), error =>
      error.message.includes("broken/tsconfig.json") && /TS\d+/.test(error.message))
    assert.equal(readFileSync(join(f.root, "p0/lib/main.js"), "utf8"), "stale")
  } finally { f.close() }
})

test("generated unrelated config neighborhoods preserve the reverse reference closure", () => {
  // existing-project.md: "They follow the reverse reference closure".
  // The generated chain is an independent model of that documented rule.
  // An unavailable framework config outside that closure must preserve its outputs.
  fc.assert(fc.property(fc.integer({ min: 2, max: 7 }), fc.nat(),
    fc.integer({ min: 1, max: 3 }), fc.boolean(), (count, index, unused, native) => {
      const f = fixture(count)
      try {
        index %= count
        const changed = "p" + index + "/src/main." + (native ? "vibe" : "ts")
        if (native) {
          rmSync(join(f.root, "p" + index + "/src/main.ts"))
          f.put(changed, "export const value = 2\n")
        }
        for (let i = 0; i < unused; i++) {
          const dir = "unused" + i
          f.put(dir + "/tsconfig.json", { extends: generatedConfig.unavailableExtends, files: ["src/main.ts"] })
          f.put(dir + "/src/main.ts", "export const ignored = 1\n")
          f.put(dir + "/lib/main.js", "keep")
          f.configs.push(dir + "/tsconfig.json")
        }
        const plan = referenceRefreshPlan({ ...f, ts, changed: [changed] })
        assert.deepEqual(plan.projects, Array.from({ length: count - index }, (_, i) => "p" + (index + i) + "/tsconfig.json"))
        assert.deepEqual(plan.roots, ["p" + (count - 1) + "/tsconfig.json"])
        const outputs = Array.from({ length: count - index }, (_, i) => "p" + (index + i))
          .flatMap(dir => [dir + "/lib", dir + "/types", dir + "/cache/build.tsbuildinfo"]).sort()
        assert.deepEqual([...plan.outputs].sort(), outputs)
        for (let i = 0; i < unused; i++) assert.equal(readFileSync(join(f.root, "unused" + i + "/lib/main.js"), "utf8"), "keep")
      } finally { f.close() }
    }), { numRuns: 40, seed: 514143 })
})

test("stock TypeScript builds selected references without unrelated generated configs", () => {
  const f = fixture()
  try {
    addGeneratedConfig(f)
    const cli = require.resolve("typescript/bin/tsc")
    const selected = spawnSync(process.execPath, [cli, "--build", "p2/tsconfig.json", "--pretty", "false"],
      { cwd: f.root, encoding: "utf8", timeout: 30000 })
    assert.equal(selected.status, 0, selected.stdout + selected.stderr)
    assert.doesNotMatch(selected.stdout + selected.stderr, /\$app\/tsconfig/)
    const invalid = spawnSync(process.execPath, [cli, "--build", generatedConfig.unrelatedConfig, "--pretty", "false"],
      { cwd: f.root, encoding: "utf8", timeout: 30000 })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stdout + invalid.stderr, /TS6053/)
  } finally { f.close() }
})

test("compiler resolution is deferred until a generated reference graph needs rebuilding", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 5 }), fc.boolean(), async (count, unavailable) => {
    const f = fixture(count)
    try {
      let resolutions = 0, executions = 0
      const refresh = refreshProjectReferences({ ...f, ts: count ? ts : undefined,
        changed: ["p0/src/main.ts"], log: join(f.root, "deferred.log"),
        compiler: () => {
          resolutions++
          if (unavailable) throw new Error("fixture compiler unavailable")
          return "vibelang"
        },
        execute: async command => {
          executions++
          assert.match(command, /^'vibelang' --build --force --pretty false/)
          return { code: 0, stdout: "", stderr: "" }
        } })
      if (count > 1 && unavailable) {
        await assert.rejects(refresh, /fixture compiler unavailable/)
        for (let i = 0; i < count; i++) for (const output of corpus.outputs)
          assert.equal(readFileSync(join(f.root, "p" + i, output), "utf8"), "stale")
      } else {
        const receipt = await refresh
        assert.equal(receipt.state, count > 1 ? "complete" : "not-needed")
      }
      assert.equal(resolutions, count > 1 ? 1 : 0)
      assert.equal(executions, count > 1 && !unavailable ? 1 : 0)
    } finally { f.close() }
  }), { numRuns: 30, seed: 515151 })
})
