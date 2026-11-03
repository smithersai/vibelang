import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const stock = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "typescript/bin/tsc")
const options = { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], declaration: true, emitDeclarationOnly: true, rewriteRelativeImportExtensions: true }
const put = (root, file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value)) }
const outputs = (root, suffix) => readdirSync(root, { recursive: true }).filter(f => f.endsWith(suffix)).sort()
const run = (command, args, root) => spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 60000 })

for (const mode of ["beside", "directory", "rootDir", "references", "inferred"]) {
  test("outside-config sidecars match tsc: " + mode, { skip: !existsSync(binary) || !existsSync(stock) }, t => {
    const root = mkdtempSync(join(tmpdir(), "sidecar-outside-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const seen = []
    for (const ext of ["ts", "vibe"]) {
      const home = join(root, ext)
      const config = (owner) => ({
        compilerOptions: { ...options,
          ...(mode === "references" ? { composite: true, rootDir: "src", declarationDir: "public" } : {}),
          ...(mode === "rootDir" ? { rootDir: "src" } : {}),
          ...(ext === "ts" && (mode === "directory" || mode === "inferred") ? { declarationDir: "decl" } : {}) },
        ...(ext === "vibe" ? { vibe: { effectGlobals: false, effectModules: false, ...(mode === "directory" || mode === "references" || mode === "inferred" ? { sidecarDir: "decl" } : owner ? { sidecarDir: "owner-decl" } : {}) } } : {}),
        include: ["src"],
        ...(mode === "references" && !owner ? { references: [{ path: "../a" }] } : {})
      })
      // The owning config's setting must not affect an unreferenced compile.
      put(home, "a/tsconfig.json", config(true))
      put(home, "b/tsconfig.json", config(false))
      put(home, (mode === "inferred" ? "b" : "a") + "/src/x." + ext, "export const x = 1\n")
      put(home, "b/src/z." + ext, 'export { x } from "' + (mode === "inferred" ? "./x." : "../../a/src/x.") + ext + '"\n')
      const args = mode === "references" ? ["-b", "b", "--pretty", "false"] : ["-p", "b", "--pretty", "false"]
      const result = ext === "ts" ? run(process.execPath, [stock, ...args], home) : run(binary, args, home)
      const codes = [...(result.stdout + result.stderr).matchAll(/error (TS\d+|EK\d+):/g)].map(m => m[1]).sort()
      const files = outputs(home, ext === "ts" ? ".d.ts" : ".d.vibe.ts")
        .map(f => f.replaceAll("\\", "/").replace(/\.d\.vibe\.ts$/, ".d.ts").replaceAll("/public/", "/decl/"))
      seen.push({ success: result.status === 0, codes, files })
      if (mode !== "rootDir") assert.equal(result.status, 0, ext + ": " + result.stdout + result.stderr)
    }
    assert.deepEqual(seen[1], seen[0])
    if (mode === "directory") assert.deepEqual(seen[1].files, ["b/decl/a/src/x.d.ts", "b/decl/b/src/z.d.ts"])
    if (mode === "inferred") assert.deepEqual(seen[1].files, ["b/decl/x.d.ts", "b/decl/z.d.ts"])
    if (mode === "references") assert.deepEqual(seen[1].files, ["a/decl/x.d.ts", "b/decl/z.d.ts"])
    if (mode === "rootDir") assert.ok(seen[1].codes.includes("TS6059"))
  })
}
