import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { test } from "node:test"
import { jsonc, planBuild, runBuild } from "../templates/typecheck.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")

function fixture(files, action) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-typecheck-build-"))
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), typeof text === "string" ? text : JSON.stringify(text))
    }
    return action(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("typecheck combines the original reference graph and orphan .vibe owners in one build", () => fixture({
  "package.json": {},
  "tsconfig.json": { files: [], references: [{ path: "./packages/a" }] },
  "packages/a/tsconfig.json": { include: ["src"] },
  "packages/a/src/a.vibe": "export const a = 1",
  "packages/b/tsconfig.json": { include: ["src"] },
  "packages/b/src/b.vibe": "export const b = 1"
}, root => {
  const seen = []
  const configs = {
    "tsconfig.json": { files: [], references: [{ path: "packages/a" }] },
    "packages/a/tsconfig.json": { files: ["src/a.vibe"] },
    "packages/b/tsconfig.json": { files: ["src/b.vibe"] }
  }
  const invoke = args => {
    seen.push(args)
    if (args[0] === "--showConfig") return { status: 0, stdout: JSON.stringify(configs[relative(root, args[2])]) }
    return { status: 0 }
  }
  assert.equal(runBuild(root, { projects: ["tsconfig.json"] }, { invoke, log: () => {} }), 0)
  assert.equal(seen.filter(a => a[0] === "--build").length, 1)
  assert.equal(seen.some(a => a.includes("--noEmit")), false)
  const build = seen.find(a => a[0] === "--build")
  assert.equal(relative(root, build[1]), "tsconfig.json")
  const overlay = JSON.parse(readFileSync(build[2], "utf8"))
  assert.equal(overlay.compilerOptions.noEmit, true)
  assert.equal(overlay.extends, "./tsconfig.json")
  assert.equal(new Set(seen.filter(a => a[0] === "--showConfig").map(a => a[2])).size, 3)
  const receipt = JSON.parse(readFileSync(join(root, ".cache/vibelang-typecheck.json")))
  assert.equal(receipt.graph.length, 3)
  assert.equal(receipt.status, 0)
}))

test("an unreferenced options overlay cannot claim an otherwise excluded module", () => fixture({
  "tsconfig.json": { files: [] },
  "tsconfig.base.json": { compilerOptions: { strict: true } },
  "excluded/bad.vibe": 'export const n: number = "bad"'
}, root => {
  const invoke = args => ({ status: 0, stdout: JSON.stringify(relative(root, args[2]) === "tsconfig.base.json" ? { files: ["excluded/bad.vibe"] } : { files: [] }) })
  assert.throws(() => planBuild(root, { projects: ["tsconfig.json"] }, invoke), /No prepared source project owns.*excluded\/bad.vibe/)
}))

test("metadata crashes and unprepared exclusions cannot print a successful build", () => fixture({
  "tsconfig.json": { files: [] }, "src/a.vibe": "export const a = 1"
}, root => {
  assert.throws(() => planBuild(root, { projects: ["tsconfig.json"] }, () => ({ status: null, error: new Error("timed out") })), /Cannot read project.*timed out/)
  assert.throws(() => planBuild(root, { projects: ["tsconfig.json"] }, () => ({ status: 0, stdout: "not JSON" })), /Invalid --showConfig/)
}))

test("property: duplicate and diamond references have one metadata query per project and one compiler build", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 16 }), fc.array(fc.integer({ min: 0, max: 15 }), { maxLength: 40 }), (count, links) => {
    const files = { "package.json": {}, "tsconfig.json": { files: [], references: [] } }
    for (let i = 0; i < count; i++) {
      files["p" + i + "/tsconfig.json"] = { include: ["*.vibe"] }
      files["p" + i + "/main.vibe"] = "export const n = " + i
    }
    fixture(files, root => {
      const reads = new Map(), builds = []
      const invoke = args => {
        if (args[0] === "--build") { builds.push(args); return { status: 0 } }
        const path = relative(root, args[2])
        reads.set(path, (reads.get(path) ?? 0) + 1)
        if (path === "tsconfig.json") return { status: 0, stdout: JSON.stringify({ files: [], references: links.map(n => ({ path: "p" + (n % count) })) }) }
        const i = Number(path.match(/^p(\d+)\//)[1])
        return { status: 0, stdout: JSON.stringify({ files: ["main.vibe"], references: i ? [{ path: "../p" + (i - 1) }] : [] }) }
      }
      assert.equal(runBuild(root, { projects: ["tsconfig.json"] }, { invoke, log: () => {} }), 0)
      assert.equal(builds.length, 1)
      assert.equal([...reads.values()].every(n => n === 1), true)
      assert.deepEqual(JSON.parse(readFileSync(join(root, ".cache/vibelang-typecheck.json"))).graph,
        ["tsconfig.json", ...Array.from({ length: count }, (_, i) => "p" + i + "/tsconfig.json")].sort())
    })
  }), { seed: 55055, numRuns: 100 })
})

test("property: JSONC comments and trailing commas leave quoted paths intact", () => {
  fc.assert(fc.property(fc.string(), text => {
    const encoded = JSON.stringify(text)
    assert.deepEqual(jsonc('/* head */ {"path":' + encoded + ', // end\n"list":[' + encoded + ',],}'), { path: text, list: [text] })
  }), { seed: 55056, numRuns: 300 })
})

test("planning is read-only, including noEmit overlays", () => fixture({
  "tsconfig.json": { include: ["src"] }, "src/main.vibe": "export const n = 1"
}, root => {
  const invoke = () => ({ status: 0, stdout: JSON.stringify({ files: ["src/main.vibe"] }) })
  const plan = planBuild(root, { projects: [{ path: "tsconfig.json", noEmit: true }] }, invoke)
  assert.equal(plan.artifacts.length, 1)
  assert.equal(require("node:fs").existsSync(join(root, ".cache")), false)
  assert.equal(JSON.parse(plan.artifacts[0].text).compilerOptions.noEmit, true)
}))

test("metadata failure retains its stage and message in the ignored progress receipt", () => fixture({
  "tsconfig.json": { files: [] }
}, root => {
  assert.throws(() => runBuild(root, { projects: ["tsconfig.json"] }, { log: () => {}, invoke: () => ({ status: null, error: new Error("metadata deadline") }) }), /metadata deadline/)
  const receipt = JSON.parse(readFileSync(join(root, ".cache/vibelang-typecheck.json")))
  assert.equal(receipt.phase, "metadata")
  assert.match(receipt.error, /metadata deadline/)
  assert.equal(receipt.status, null)
}))

test("a metadata diagnostic printed on stdout remains visible when stderr is empty", () => fixture({
  "tsconfig.json": { files: [] }
}, root => {
  assert.throws(() => planBuild(root, { projects: ["tsconfig.json"] }, () => ({
    status: 2, stdout: "error TS5023: unsupported option in original project", stderr: ""
  })), /TS5023.*unsupported option/)
}))

test("preparation records its current phase before invoking a child", () => fixture({
  "tsconfig.json": { files: [] }
}, root => {
  assert.throws(() => runBuild(root, { projects: ["tsconfig.json"], prepare: ["prepare-sources"] }, {
    log: () => {}, invoke: () => assert.fail("must not compile after preparation fails"),
    prepare: () => {
      const receipt = JSON.parse(readFileSync(join(root, ".cache/vibelang-typecheck.json")))
      assert.equal(receipt.phase, "prepare")
      assert.equal(receipt.status, null)
      assert.ok(receipt.at)
      return { status: 1 }
    }
  }), /preparation failed/)
}))


test("property: generated checks preserve each project's type-library resolution and config-directory defaults", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-typecheck-project-context.json", import.meta.url), "utf8"))
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.constantFrom(...corpus.libraries), fc.constantFrom("p", "project with spaces", "nested/project"), (composite, explicit, library, directory) => {
    const options = { composite, types: [library.name], ...(explicit ? { rootDir: "." } : {}) }
    fixture({
      [directory + "/tsconfig.json"]: { compilerOptions: options, files: ["src/main.vibe"] },
      [directory + "/src/main.vibe"]: corpus.source,
      [directory + "/" + library.file]: corpus.declaration
    }, root => {
      const original = join(root, directory, "tsconfig.json")
      const invoke = () => ({ status: 0, stdout: JSON.stringify({ compilerOptions: options, files: ["src/main.vibe"] }) })
      const plan = planBuild(root, { projects: [{ path: directory + "/tsconfig.json", noEmit: true }] }, invoke)
      const [artifact] = plan.artifacts
      assert.equal(dirname(artifact.path), dirname(original))
      writeFileSync(artifact.path, artifact.text)
      const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, " ")) }
      const before = ts.getParsedCommandLineOfConfigFile(original, {}, host)
      const after = ts.getParsedCommandLineOfConfigFile(artifact.path, {}, host)
      const resolved = (path, options) => ts.resolveTypeReferenceDirective(library.name, path, options, ts.sys).resolvedTypeReferenceDirective?.resolvedFileName
      const expected = resolved(original, before.options)
      assert.ok(expected, "original project resolves " + library.name)
      assert.equal(resolved(artifact.path, after.options), expected)
      assert.equal(after.options.composite, before.options.composite)
      assert.equal(after.options.rootDir, before.options.rootDir)
      assert.equal(after.options.noEmit, true)
    })
  }), { seed: 55058, numRuns: 200 })
})

test("preparation diagnostics identify the step without echoing shell environment values", () => fixture({
  "package.json": {}, "tsconfig.json": { files: [] }
}, root => {
  const logs = []
  const command = "EXAMPLE_PRIVATE_VALUE=fixture-only run-codegen"
  assert.throws(() => runBuild(root, { projects: ["tsconfig.json"], prepare: [command] }, {
    invoke: () => assert.fail("failed preparation must not reach metadata"),
    prepare: actual => { assert.equal(actual, command); return { status: 9 } },
    log: message => logs.push(message)
  }), /preparation failed.*exit 9/)
  assert.ok(logs.some(message => message.includes("step 1/1")))
  assert.ok(logs.every(message => !message.includes("EXAMPLE_PRIVATE_VALUE") && !message.includes("fixture-only")))
  const receipt = readFileSync(join(root, ".cache/vibelang-typecheck.json"), "utf8")
  assert.ok(!receipt.includes("EXAMPLE_PRIVATE_VALUE") && !receipt.includes("fixture-only"))
}))
