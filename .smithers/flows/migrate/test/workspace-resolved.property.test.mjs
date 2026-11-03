import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addCompilerScripts, packagesReaching, startsWorkers, viteAppConfigs } from "../lib/wire.mjs"
import { wireNodeTests } from "../lib/node-tests.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([new URL("../../../../packages/runtime/", import.meta.url).pathname])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-figma-workspace-peer.json", import.meta.url), "utf8"))
const toolingQuote = "linters, Knip, bundlers and test runners each read `.vibe`."
const reachingQuote = "every package that runs `bun test` and reaches a migrated package through workspace dependencies"

function fixture(run, installed = true) {
  const root = mkdtempSync(join(tmpdir(), "opencode-workspace-peer-"))
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
  }
  const link = (from, to) => {
    mkdirSync(dirname(join(root, from)), { recursive: true })
    rmSync(join(root, from), { recursive: true, force: true })
    symlinkSync(relative(dirname(join(root, from)), join(root, to)), join(root, from), "dir")
  }
  try {
    for (const [file, value] of Object.entries(corpus.files)) put(file, value)
    if (installed) for (const [name, dir] of Object.entries(corpus.packages)) link("node_modules/" + name, dir)
    return run({ root, put, link })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const reached = root => packagesReaching(root, ["packages/ai"]).map(pkg => pkg.dir).sort()
const expected = ["packages/ai", "packages/plugin", "packages/plugins/figma"]

test("workspace dependency oracle quotes the setup contract and Chapter 7", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(toolingQuote))
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(reachingQuote))
})

test("opencode Figma: a semver peer resolves to the workspace and joins compiler wiring", () => fixture(({ root }) => {
  const native = createRequire(join(root, "packages/plugins/figma/probe.cjs"))
  assert.equal(realpathSync(native.resolve("@opencode/plugin")), realpathSync(join(root, "packages/plugin/index.js")))
  assert.throws(() => native.resolve("@opencode/plugin/package.json"), /PACKAGE_PATH_NOT_EXPORTED/)
  assert.deepEqual(reached(root), expected)
  const figma = packagesReaching(root, ["packages/ai"]).find(pkg => pkg.dir === "packages/plugins/figma")
  assert.equal(addCompilerScripts(figma.manifest, "file:compiler.tgz").scripts["typecheck:tsc"], "vibelang --noEmit")
}))

test("an installed registry package shadows a same-name compatible workspace", () => fixture(({ root, put, link }) => {
  put(".registry/plugin/package.json", { name: "@opencode/plugin", version: "2.2.0", type: "module", exports: "./index.js" })
  put(".registry/plugin/index.js", "export const value = 2\n")
  link("packages/plugins/figma/node_modules/@opencode/plugin", ".registry/plugin")
  assert.equal(realpathSync(createRequire(join(root, "packages/plugins/figma/probe.cjs")).resolve("@opencode/plugin")), realpathSync(join(root, ".registry/plugin/index.js")))
  assert.deepEqual(reached(root), ["packages/ai", "packages/plugin"])
}))

test("resolved npm aliases and optional dependencies retain the workspace's identity", () => fixture(({ root, put, link }) => {
  const file = "packages/plugins/figma/package.json"
  const pkg = JSON.parse(readFileSync(join(root, file), "utf8"))
  delete pkg.peerDependencies
  pkg.optionalDependencies = { "plugin-alias": "npm:@opencode/plugin@^2.0.27" }
  put(file, pkg); link("node_modules/plugin-alias", "packages/plugin")
  assert.deepEqual(reached(root), expected)
}))

test("worker discovery and hidden Node runtime owners follow resolved workspace peers", () => fixture(({ root, put }) => {
  put("packages/plugin/worker-source.ts", 'export const open = () => new Worker(new URL("./worker.ts", import.meta.url))\n')
  put("packages/plugins/figma/vite.config.ts", "export default {}\n")
  assert.equal(startsWorkers(root, "packages/plugins/figma"), true)
  assert.deepEqual(viteAppConfigs(root, ["packages/ai"]), ["packages/plugins/figma/vite.config.ts"])
  put(".smithers/flows/package.json", { private: true, peerDependencies: { "@opencode/plugin": "^2.0.27 || ^0.0.0-dev" } })
  put(".smithers/flows/PACKAGE.ts", "export const runtime = Runtime.Node({})\n")
  const options = { root, packages: [{ dir: "packages/ai" }], ts, specsFor: () => ({ vibelang: "file:compiler.tgz" }) }
  const first = wireNodeTests(options)
  assert.ok(first.changed.includes(".smithers/flows/PACKAGE.ts"), JSON.stringify(first))
  assert.match(readFileSync(join(root, ".smithers/flows/PACKAGE.ts"), "utf8"), /vibelang\/register/)
  assert.deepEqual(wireNodeTests(options).changed, [])
}))

test("Bun's real workspace install confirms the minimized semver-peer source edge", () => fixture(({ root }) => {
  const install = spawnSync("bun", ["install", "--ignore-scripts", "--no-progress"], { cwd: root, encoding: "utf8", timeout: 30_000 })
  assert.equal(install.status, 0, install.stdout + install.stderr)
  const run = spawnSync("bun", ["--eval", 'import { value } from "@opencode/plugin"; console.log(value)'], { cwd: join(root, "packages/plugins/figma"), encoding: "utf8", timeout: 30_000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(run.stdout.trim(), "1")
  assert.deepEqual(reached(root), expected)
}, false))

function graphOracle(nodes, edges, at, seen = new Set()) {
  if (nodes[at].migrated) return true
  if (seen.has(at)) return false
  const path = new Set([...seen, at])
  return edges[at].some(edge => edge.source && graphOracle(nodes, edges, edge.to, path))
}
function verifyGraph(nodes) {
  const root = mkdtempSync(join(tmpdir(), "workspace-resolved-graph-"))
  const put = (file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value)) }
  const link = (file, dir) => { mkdirSync(dirname(join(root, file)), { recursive: true }); rmSync(join(root, file), { recursive: true, force: true }); symlinkSync(relative(dirname(join(root, file)), join(root, dir)), join(root, file), "dir") }
  const names = nodes.map((_, i) => "@example/p" + i), dirs = nodes.map((_, i) => "packages/p" + i), final = []
  try {
    put("package.json", { private: true, workspaces: ["packages/*"] })
    for (let i = 0; i < nodes.length; i++) {
      const pkg = { name: names[i], version: "1.2.3" }, selected = new Map()
      for (const [j, edge] of nodes[i].edges.entries()) {
        const to = edge.to % nodes.length
        const name = edge.alias ? "alias-" + i + "-" + j : names[to]
        ;(pkg[edge.field] ??= {})[name] = edge.alias ? "npm:" + names[to] + "@^1.0.0" : "^1.0.0 || ^0.0.0-dev"
        selected.set(name, { ...edge, to, name })
      }
      put(dirs[i] + "/package.json", pkg); put(dirs[i] + "/index.js", "export const marker = " + i + "\n")
      final.push([...selected.values()])
    }
    for (let i = 0; i < nodes.length; i++) link("node_modules/" + names[i], dirs[i])
    for (let i = 0; i < nodes.length; i++) for (const edge of final[i]) {
      link("node_modules/" + edge.name, dirs[edge.to])
      if (edge.source && !edge.local) continue
      const target = edge.source ? dirs[edge.to] : ".registry/p" + i + "-" + edge.name.replaceAll("/", "-")
      if (!edge.source) {
        put(target + "/package.json", { name: names[edge.to], version: "1.2.3", exports: "./index.js" })
        put(target + "/index.js", "exports.marker = -1\n")
      }
      link(dirs[i] + "/node_modules/" + edge.name, target)
    }
    const migrated = dirs.filter((_, i) => nodes[i].migrated)
    const expected = dirs.filter((_, i) => graphOracle(nodes, final, i)).sort()
    assert.deepEqual(packagesReaching(root, migrated).map(pkg => pkg.dir).sort(), expected)
    assert.deepEqual(packagesReaching(root, [...migrated].reverse()).map(pkg => pkg.dir).sort(), expected)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("property: installed source identities determine cyclic peer/dev/optional reachability", async () => {
  await checkProperty(fc, {
    name: "opencode-resolved-workspace-peer",
    rule: toolingQuote + " " + reachingQuote + "; the installed module identity, not a semver spelling, decides whether a reader loads workspace sources.",
    command: "node --test .smithers/flows/migrate/test/workspace-resolved.property.test.mjs",
    arbitrary: fc.array(fc.record({ migrated: fc.boolean(), edges: fc.array(fc.record({
      to: fc.nat(31), source: fc.boolean(), alias: fc.boolean(), local: fc.boolean(),
      field: fc.constantFrom("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"),
    }), { maxLength: 3 }) }), { minLength: 2, maxLength: 6 }),
    numRuns: 120,
    check: verifyGraph,
  })
})
