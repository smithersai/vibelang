import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")

export const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
export function prepare(root, label, { folder = "feature", form = "star", addition = "private", changed = false } = {}) {
  const pkg = join(root, label, "package"), snapshot = join(root, label, "snapshot")
  mkdirSync(snapshot, { recursive: true })
  const manifest = { name: "foldkit-markdown-corpus", exports: { ".": { types: "./dist/index.d.ts" }, "./content": { types: "./content.d.ts" } } }
  put(pkg, "package.json", JSON.stringify(manifest))
  put(pkg, "tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist", declaration: true }, include: ["src/**/*"] }))
  const body = form === "namespace" ? 'export * as Feature from "./dist/' + folder + '";\n' : form === "type" ? 'export type API = import("./dist/' + folder + '").Item;\n' : 'export * from "./dist/' + folder + '";\n'
  put(pkg, "content.d.ts", (changed && label === "after" ? "export type Introduced = number;\n" : "") + body)
  const files = { "index.d.ts": "export declare const main: number;\n", [folder + "/index.d.ts"]: "export interface Item { original: number }\n" }
  if (label === "after") files[addition === "shadow" ? folder + ".d.ts" : "private.d.ts"] = "export interface Item { introduced: string }\n"
  for (const [file, text] of Object.entries(files)) {
    put(snapshot, file, text)
    put(pkg, "dist/" + file, text)
    put(pkg, "src/" + file.replace(/\.d\.ts$/, ".ts"), "export {};\n")
  }
  const surface = recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
  return { pkg, snapshot, surface }
}
export function check(input) {
  const root = mkdtempSync(join(tmpdir(), "migrate-shipped-root-"))
  try {
    const before = prepare(root, "before", input), after = prepare(root, "after", input)
    assert.deepEqual(before.surface.unresolved, [])
    assert.deepEqual(after.surface.unresolved, [])
    const result = compareDeclarations(ts, before.snapshot, after.snapshot)
    const resolved = ts.resolveModuleName("./dist/" + (input.folder ?? "feature"), join(after.pkg, "content.d.ts"), { moduleResolution: ts.ModuleResolutionKind.Node10 }, ts.sys).resolvedModule
    assert.ok(resolved)
    assert.equal(resolved.resolvedFileName.endsWith("/index.d.ts"), input.addition !== "shadow")
    assert.equal(result.identical, input.addition !== "shadow" && !input.changed, JSON.stringify(result))
    assert.deepEqual(input.addition === "shadow" ? result.added : result.addedPrivate, [input.addition === "shadow" ? input.folder + ".d.ts" : "private.d.ts"])
    // The run must not consult a live root after taking its snapshot.
    put(before.pkg, "content.d.ts", "// overwritten after snapshot\nexport {};\n")
    assert.equal(compareDeclarations(ts, before.snapshot, after.snapshot).identical, result.identical)
    return true
  } finally { rmSync(root, { recursive: true, force: true }) }
}
