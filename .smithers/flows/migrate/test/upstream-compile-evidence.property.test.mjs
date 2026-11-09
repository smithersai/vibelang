import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { check } from "../lib/diagnostics.mjs"
import * as Baseline from "../lib/baseline.mjs"
import * as Jj from "../lib/jj.mjs"
import { packRepository } from "../lib/pack-policy.mjs"
import { makeConfig, paths, setup } from "../lib/steps.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(
  new URL("../../../../packages/runtime/package.json", import.meta.url)
)
const fc = require("fast-check")
const native = fileURLToPath(
  new URL("../../../../packages/compiler/native/vibelang", import.meta.url)
)
const corpus = JSON.parse(
  readFileSync(
    new URL("./corpus/upstream-compile-evidence.json", import.meta.url),
    "utf8"
  )
)
const failure = /toolchain baseline regression/
const read = (file) => JSON.parse(readFileSync(file, "utf8"))

test("original compiler evidence oracle quotes the migration contract", () => {
  assert.ok(
    readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(
      corpus.quote
    )
  )
})

test(
  "real setup replay retains missing original compiler evidence",
  { timeout: 120000 },
  async () => {
    assert.ok(
      existsSync(native),
      "Build the native compiler before running the setup layout integration test"
    )
    const root = mkdtempSync(join(tmpdir(), "setup-compile-layout-"))
    const target = join(root, "repo"),
      run = join(root, "run"),
      p = paths(run)
    const put = (name, value) => {
      const file = join(target, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(
        file,
        typeof value === "string" ? value : JSON.stringify(value)
      )
    }
    try {
      put("package.json", {
        name: "setup-layout-fixture",
        version: "1.0.0",
        private: true,
        type: "module"
      })
      put(".gitignore", "node_modules/\ndist/\n")
      put("tsconfig.json", {
        compilerOptions: {
          strict: true,
          types: [],
          target: "ES2022",
          module: "ESNext",
          rootDir: "src",
          outDir: "dist"
        },
        include: ["src"]
      })
      put("src/main.ts", corpus.source)
      mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
      symlinkSync(
        dirname(require.resolve("typescript/package.json")),
        join(target, "node_modules/typescript")
      )
      symlinkSync(native, join(target, "node_modules/.bin/vibelang"))
      await must(
        "jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",
        { cwd: target }
      )
      const revision = await Jj.commit(target, "original setup sources")
      const config = makeConfig({
        target,
        packages: ["."],
        test: "true",
        vibelangVersion: "0.0.13",
        wire: false
      })
      writeJson(p.config, config)
      writeJson(p.upgrade, {
        jj: { initialized: true, commit: revision, baseCommit: revision },
        effect: { to: "4.1.1" },
        changed: [],
        tests: {}
      })
      writeJson(join(p.baseline, "upgraded-tests.json"), {
        code: 0,
        tests: {}
      })
      const checks = {
        ".": { compiler: "original", code: 0, diagnostics: [] }
      }
      writeJson(join(p.baseline, "upstream-checks.json"), checks)
      writeJson(join(p.baseline, "upgraded-checks.json"), checks)
      writeJson(
        join(p.baseline, "upstream-packs.json"),
        await packRepository(config, join(run, "packs"))
      )
      await setup({ run })
      put("src/main.ts", 'export const value: number = "invalid"\n')
      const failed = await check({
        compiler: native,
        tsconfig: "tsconfig.json",
        cwd: target,
        root: target,
        log: join(run, "current-compile.log")
      })
      assert.equal(failed.code, 2, JSON.stringify(failed))
      assert.ok(
        failed.diagnostics.some((diagnostic) => diagnostic.code === "TS2322")
      )
      Baseline.recordSetupCompile(p, ".", failed)
      assert.throws(() => Baseline.assertBaselineSafe(p), failure)
      rmSync(join(p.baseline, "upstream-checks.json"))
      await assert.rejects(setup({ run }), failure)
      const row = read(join(p.baseline, "admission.json")).compile.find(
        (row) => row.package === "."
      )
      assert.equal(row.state, "unverified")
      assert.equal(row.receipt, "upstream-checks.json")
      assert.match(row.reason, /original compiler check.*missing/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

function model({
  pkg = ".",
  missing = "file",
  completed = true,
  includeSetup = true,
  afterCode = 2,
  setupOnly = false
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "original-compile-evidence-")),
    p = paths(root)
  const before = { compiler: "original", code: 0, diagnostics: [] }
  try {
    writeJson(join(p.baseline, "upstream-checks.json"), {
      retained: before,
      [pkg]: before
    })
    writeJson(join(p.baseline, "upgraded-checks.json"), {
      retained: before,
      ...(setupOnly ? {} : { [pkg]: before })
    })
    Baseline.recordSetupCompile(p, pkg, { code: afterCode, diagnostics: [] })
    if (completed) writeJson(p.setup, { compile: { retained: {}, [pkg]: {} } })
    if (missing === "file") rmSync(join(p.baseline, "upstream-checks.json"))
    if (missing === "entry")
      writeJson(join(p.baseline, "upstream-checks.json"), { retained: before })
    if (missing === "null")
      writeJson(join(p.baseline, "upstream-checks.json"), {
        retained: before,
        [pkg]: null
      })
    const known =
      missing === "null" || !setupOnly || (completed && includeSetup)
    if (known) {
      assert.throws(
        () => Baseline.assertBaselineSafe(p, { includeSetup }),
        failure
      )
      const rows = read(join(p.baseline, "admission.json")).compile
      const missingRow = rows.find((row) => row.package === pkg)
      assert.equal(missingRow.state, "unverified")
      assert.equal(missingRow.receipt, "upstream-checks.json")
      assert.match(missingRow.reason, /original compiler check.*missing/)
      assert.equal(missingRow.ok, false)
    } else
      assert.equal(
        Baseline.assertBaselineSafe(p, { includeSetup }).state,
        "accepted"
      )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("original compiler evidence remains required for healthy and failing current outcomes", () => {
  for (const missing of ["file", "entry", "null"])
    for (const afterCode of [0, 2]) model({ missing, afterCode })
})

test("completed setup retains a package missing from both predecessor maps", () => {
  for (const includeSetup of [false, true])
    model({ missing: "entry", setupOnly: true, includeSetup })
})

test("property: recorded packages never disappear when original compiler evidence is lost", () => {
  fc.assert(
    fc.property(
      fc.record({
        pkg: fc.constantFrom(...corpus.packages),
        missing: fc.constantFrom("file", "entry", "null"),
        completed: fc.boolean(),
        includeSetup: fc.boolean(),
        afterCode: fc.constantFrom(0, 2)
      }),
      model
    ),
    { seed: 377900, numRuns: 240 }
  )
})
