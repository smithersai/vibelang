import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { sidecarPath, sidecarSettings } from "../lib/sidecar-config.mjs"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const require = createRequire(join(runtime, "package.json"))
const ts = require("typescript")
const fc = require("fast-check")
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text)) }

test("Smithers: setup relocates an outside imported source without a TypeScript enumeration", async t => {
 const root = mkdtempSync(join(tmpdir(), "sidecar-outside-setup-"))
 t.after(() => rmSync(root, { recursive: true, force: true }))
 put(root, "package.json", { name: "outside-fixture", private: true, type: "module", workspaces: ["a", "b"] })
 for (const pkg of ["a", "b"]) {
  put(root, pkg + "/package.json", { name: pkg, private: true })
  put(root, pkg + "/tsconfig.json", { compilerOptions: { noEmit: true }, include: ["src"] })
 }
 put(root, "a/tsconfig.json", { compilerOptions: { noEmit: true, rootDirs: [".", "own"] }, vibe: { sidecarDir: "own" }, include: ["src"] })
 put(root, "a/src/x.vibe", "export const x = 1\n")
 put(root, "b/src/z.vibe", 'export { x } from "../../a/src/x.vibe"\n')
 mkdirSync(join(root, "node_modules"))
 symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
 await must("jj git init", { cwd: root })
 await must("jj config set --repo user.name test", { cwd: root })
 await must("jj config set --repo user.email test@localhost", { cwd: root })
 const config = makeConfig({ target: root, packages: ["a", "b"], test: "true", vibelangVersion: "0.0.11", install: "true" })
 await wireTarget(config, join(root, ".logs"))
 const read = () => JSON.parse(readFileSync(join(root, "b/tsconfig.json"), "utf8"))
 const owner = JSON.parse(readFileSync(join(root, "a/tsconfig.json"), "utf8"))
 assert.equal(owner.vibe.sidecarDir, "own")
 assert.deepEqual(owner.compilerOptions.rootDirs, [".", "own", "src"])
 assert.equal(read().vibe?.sidecarDir, ".vibe/declarations")
 assert.deepEqual(read().compilerOptions.rootDirs, ["..", ".vibe/declarations"])
 assert.equal(sidecarPath(join(root, "a/src/x.vibe"), sidecarSettings(join(root, "b/tsconfig.json"), ts)), join(root, "b/.vibe/declarations/a/src/x.d.vibe.ts"))
 const before = readFileSync(join(root, "b/tsconfig.json"), "utf8")
 await wireTarget(config, join(root, ".logs"))
 assert.equal(readFileSync(join(root, "b/tsconfig.json"), "utf8"), before)
})

test("property: setup sidecar mapping follows the source graph across config boundaries", () => {
 fc.assert(fc.property(fc.integer({ min: 0, max: 3 }), fc.constantFrom("decl", ".vibe/declarations"), fc.boolean(), (depth, output, reference) => {
  const root = mkdtempSync(join(tmpdir(), "sidecar-outside-layout-"))
  try {
   const nested = "deep/".repeat(depth)
   put(root, "a/src/" + nested + "x.vibe", "export const x = 1\n")
   put(root, "a/tsconfig.json", { compilerOptions: { composite: true, rootDir: "src" }, vibe: { sidecarDir: "own" }, include: ["src"] })
   put(root, "b/src/z.vibe", 'export { x } from "../../a/src/' + nested + 'x.vibe"\n')
   put(root, "b/tsconfig.json", { compilerOptions: { noEmit: true, ...(reference ? { composite: true, rootDir: "src" } : {}) }, vibe: { sidecarDir: output }, include: ["src"], ...(reference ? { references: [{ path: "../a" }] } : {}) })
   const settings = sidecarSettings(join(root, "b/tsconfig.json"), ts)
   if (reference) {
    assert.equal(sidecarPath(join(root, "b/src/z.vibe"), settings), join(root, "b", output, "z.d.vibe.ts"))
   } else {
    assert.equal(sidecarPath(join(root, "a/src/" + nested + "x.vibe"), settings), join(root, "b", output, "a/src", nested, "x.d.vibe.ts"))
    assert.equal(sidecarPath(join(root, "b/src/z.vibe"), settings), join(root, "b", output, "b/src/z.d.vibe.ts"))
   }
  } finally { rmSync(root, { recursive: true, force: true }) }
 }), { numRuns: 20 })
})
