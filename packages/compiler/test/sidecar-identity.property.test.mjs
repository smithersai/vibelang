import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { filesOf } from "./sidecar-identity-files.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const stock = process.env.VIBELANG_STOCK_TSC || join(repo, "packages/runtime/node_modules/.bin/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(repo, "packages/runtime")
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-sidecar-source-identity.json", import.meta.url), "utf8"))
const raw = process.env.VIBELANG_SIDECAR_IDENTITY_RAW === "1"
const sourceIdentityQuote = "A non-relative specifier that TypeScript resolves to `x.d.vibe.ts` or `x.d.vibex.ts`, through a package `types` export, a `paths` entry or package `#imports`, resolves to the available `x.vibe` or `x.vibex` source when the final resolved path is outside `node_modules`."

test("the sidecar identity oracle quotes the current specification and literal source hashes", () => {
  const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8")
  assert.ok(chapter.includes(sourceIdentityQuote))
  for (const [name, hash] of Object.entries(fixture.hashes)) {
    assert.equal(createHash("sha256").update(fixture.files[name]).digest("hex"), hash, name)
  }
})

function write(root, files) {
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
}

function inspect(input, literal) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-sidecar-identity-"))
  try {
    const nm = join(root, "node_modules")
    mkdirSync(nm)
    symlinkSync(join(modules, "effect"), join(nm, "effect"), "dir")
    symlinkSync(runtime, join(nm, "vibelang-runtime"), "dir")
    symlinkSync("../lib", join(nm, "lib"), "dir")
    const files = literal || filesOf(input)
    const runs = {}
    for (const [engine, compiler] of [["stock", stock], ["native", binary]]) {
      // An emit may refresh compatibility sidecars: each engine reads the
      // same original files, including the declaration under test.
      write(root, files)
      const result = spawnSync(compiler, ["-p", "app/tsconfig.json", "--pretty", "false", "--allowImportingTsExtensions", "true"], {
        cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 2 << 20,
        env: { ...process.env, GOMAXPROCS: "2" },
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null, engine + " compiler terminated")
      const output = ((result.stdout || "") + (result.stderr || "")).replaceAll(root, "<project>").replaceAll("\\", "/")
      runs[engine] = { status: result.status, output, codes: [...output.matchAll(/error ((?:TS|EK)\d+)/g)].map(m => m[1]) }
    }
    return runs
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function check(input, literal) {
  const runs = inspect(input, literal)
  assert.equal(runs.stock.status, 0, "invalid stock TypeScript control:\n" + runs.stock.output)
  const key = [input.brand, input.generic, input.mode, input.form].join(":")
  const pending = !raw && fixture.knownFailure?.keys.includes(key)
  if (pending) {
    assert.notEqual(runs.native.status, 0, "XPASS " + fixture.knownFailure.key + " " + key + ": retire this key")
    assert.deepEqual(runs.native.codes, ["TS2345"], "only the exact nominal identity disagreement is pending")
    assert.match(runs.native.output, /app\/src\/a[.]ts\(3,\d+\): error TS2345:/)
    const n = input.name
    if (input.brand === "hash") {
      // TypeScript abbreviates generic private-identifier types, so this
      // diagnostic carries the conflicting member instead of module paths.
      assert.match(runs.native.output, /Property '#brand'.*refers to a different member/)
    } else {
      assert.ok(runs.native.output.includes("/lib/src/" + n + ".d.vibe"), "diagnostic must name the compatibility declaration")
      assert.ok(runs.native.output.includes("/lib/src/" + n + '").' + n), "diagnostic must name the source class")
    }
  } else {
    assert.equal(runs.native.status, 0, "VIP27 source and sidecar represent one module:\n" + runs.native.output)
  }
}

test("alchemy-36: package sidecar and relative source imports have one nominal class identity", () => {
  check(fixture.input, fixture.files)
  // Source-only package exports are an independent mandatory passing control.
  check({ ...fixture.input, form: "source" })
})

test("nominal sidecar identity spans private fields, generics and consumer module modes", () => {
  fc.assert(fc.property(fc.record({
    brand: fc.constantFrom("private", "protected", "hash"),
    generic: fc.boolean(),
    mode: fc.constantFrom("commonjs", "module"),
    form: fc.constantFrom("types", "nested", "source"),
    name: fc.constantFrom("Stage", "Token", "Box"),
  }), input => check(input)), { seed: 360036, numRuns: 18, endOnFailure: true })
})
