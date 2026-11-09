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
    new URL("./corpus/setup-compile-layout.json", import.meta.url),
    "utf8"
  )
)
const failure = /toolchain baseline regression/
const read = (file) => JSON.parse(readFileSync(file, "utf8"))

test("setup compile layout oracle quotes the migration contract", () => {
  assert.ok(
    readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(
      corpus.quote
    )
  )
})

test(
  "real setup replay refuses stale legacy success after current receipts disappear",
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
      const completed = await setup({ run })
      assert.equal(Baseline.assertBaselineSafe(p).state, "accepted")
      // An older successful attempt must never replace the completed setup's own evidence.
      writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
      writeJson(join(p.baseline, "compile-" + slug(".") + ".exit.json"), {
        code: 0
      })
      for (const suffix of [".json", ".exit.json"])
        rmSync(join(p.baseline, Baseline.setupCompileKey(".") + suffix))
      await assert.rejects(setup({ run }), failure)
      const row = read(join(p.baseline, "admission.json")).compile.find(
        (row) => row.stage === "setup"
      )
      assert.equal(row.state, "unverified")
      assert.equal(row.package, ".")
      assert.match(row.reason, /completed setup.*compiler/)
      // The completion receipt retains the format even if the entire current directory is lost.
      assert.equal(completed.compileBaselineVersion, 2)
      rmSync(join(p.baseline, "compile-v2"), { recursive: true })
      await assert.rejects(setup({ run }), failure)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

function model({
  pkg = ".",
  loss = "pair",
  completed = true,
  modernCode = 0,
  legacyCode = 0,
  added = false,
  includeSetup = true,
  versioned = true
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "setup-layout-model-"))
  const p = paths(root)
  try {
    const diagnostic = {
      category: "error",
      code: "TS2322",
      file: "src/main.ts",
      line: 1,
      column: 1,
      message: "new type error",
      notes: []
    }
    writeJson(join(p.baseline, "upstream-checks.json"), {
      [pkg]: { compiler: "original", code: 0, diagnostics: [] }
    })
    writeJson(join(p.baseline, "compile-" + slug(pkg) + ".json"), [])
    writeJson(join(p.baseline, "compile-" + slug(pkg) + ".exit.json"), {
      code: legacyCode
    })
    Baseline.recordSetupCompile(p, pkg, {
      code: modernCode,
      diagnostics: added ? [diagnostic] : []
    })
    if (completed)
      writeJson(p.setup, {
        ...(versioned ? { compileBaselineVersion: 2 } : {}),
        compile: { [pkg]: {} }
      })
    const key = join(p.baseline, Baseline.setupCompileKey(pkg))
    if (loss === "directory")
      rmSync(join(p.baseline, "compile-v2"), { recursive: true })
    else
      for (const [part, suffix] of [
        ["diagnostics", ".json"],
        ["exit", ".exit.json"]
      ]) {
        if (loss === part || loss === "pair") rmSync(key + suffix)
      }
    const missingPair = loss === "pair" || loss === "directory"
    const current = Baseline.readSetupCompile(p, pkg, [pkg])
    if (missingPair)
      assert.equal(
        current,
        undefined,
        "lost current evidence must not select legacy receipts"
      )
    else
      assert.ok(
        current.receipt.startsWith("compile-v2/"),
        JSON.stringify(current)
      )
    const rejected =
      includeSetup &&
      (missingPair ? completed : loss !== "none" || modernCode !== 0 || added)
    if (rejected)
      assert.throws(
        () => Baseline.assertBaselineSafe(p, { includeSetup }),
        failure
      )
    else
      assert.equal(
        Baseline.assertBaselineSafe(p, { includeSetup }).state,
        "accepted"
      )
    const rows = read(join(p.baseline, "admission.json")).compile.filter(
      (row) => row.stage === "setup"
    )
    if (!includeSetup || (missingPair && !completed)) assert.deepEqual(rows, [])
    else {
      assert.equal(rows.length, 1)
      assert.equal(rows[0].package, pkg)
      if (loss !== "none") {
        assert.equal(rows[0].state, "unverified")
        assert.match(
          rows[0].reason,
          /missing or invalid|completed setup.*missing/
        )
        assert.equal(
          rows[0].receipt,
          missingPair
            ? "setup.json"
            : Baseline.setupCompileKey(pkg) +
                (loss === "diagnostics" ? ".json" : ".exit.json")
        )
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("current setup identity survives each receipt loss with either legacy outcome", () => {
  for (const loss of corpus.losses)
    for (const legacyCode of [0, 2]) model({ loss, legacyCode })
})

test("older current-layout runs retain their identity while the directory remains", () => {
  for (const loss of corpus.losses.filter((loss) => loss !== "directory")) {
    model({ loss, versioned: false })
  }
})

test("collecting setup never borrows stale evidence for a not-yet-recorded package", () => {
  model({ loss: "pair", completed: false, legacyCode: 2 })
})

test("legacy-only setup receipts remain readable without a current layout", () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-setup-layout-")),
    p = paths(root)
  try {
    writeJson(join(p.baseline, "upstream-checks.json"), {
      ".": { compiler: "original", code: 0, diagnostics: [] }
    })
    writeJson(p.setup, { compile: { ".": {} } })
    writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
    writeJson(join(p.baseline, "compile-" + slug(".") + ".exit.json"), {
      code: 0
    })
    assert.equal(Baseline.assertBaselineSafe(p).state, "accepted")
    writeJson(join(p.baseline, "compile-" + slug(".") + ".exit.json"), {
      code: 2
    })
    assert.throws(() => Baseline.assertBaselineSafe(p), failure)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("property: current compile evidence stays independent of stale exits and receipt loss", () => {
  fc.assert(
    fc.property(
      fc
        .record({
          pkg: fc.constantFrom(...corpus.packages),
          loss: fc.constantFrom(...corpus.losses),
          completed: fc.boolean(),
          modernCode: fc.constantFrom(0, 2),
          legacyCode: fc.constantFrom(0, 2),
          added: fc.boolean(),
          includeSetup: fc.boolean()
        })
        .filter((input) => input.loss !== "directory" || input.completed),
      model
    ),
    { seed: 376900, numRuns: 240 }
  )
})
