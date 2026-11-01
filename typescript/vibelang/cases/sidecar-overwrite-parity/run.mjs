import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// run-seconds: 240
const root = fileURLToPath(new URL("../../../", import.meta.url))
const binary = path.join(root, "built/local/tsc")
fs.mkdirSync(new URL("./out/", import.meta.url), { recursive: true })
const scratch = fs.mkdtempSync(new URL("./out/parity-", import.meta.url))
const original = Buffer.from("// hand-written declaration\r\nexport declare const original: unique symbol;\r\n")
try {
  for (const layout of ["beside", ".vibe/declarations", "types"]) {
    for (const shape of ["include", "files"]) {
      const results = []
      for (const extension of ["ts", "vibe"]) {
        const dir = path.join(scratch, layout, shape, extension)
        fs.mkdirSync(dir, { recursive: true })
        const source = "src/deep/main." + extension
        const basename = extension === "ts" ? "main.d.ts" : "main.d.vibe.ts"
        const declaration = path.posix.join(layout === "beside" ? "" : layout, "src/deep", basename)
        fs.mkdirSync(path.dirname(path.join(dir, source)), { recursive: true })
        fs.mkdirSync(path.dirname(path.join(dir, declaration)), { recursive: true })
        fs.writeFileSync(path.join(dir, source), "export const value = 42\n")
        fs.writeFileSync(path.join(dir, declaration), original)
        fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
          compilerOptions: { target: "ESNext", module: "ESNext", declaration: true, types: [], skipLibCheck: true, rootDir: ".",
            ...(layout !== "beside" && extension === "ts" ? { declarationDir: layout } : {}) },
          vibe: { effectGlobals: false, effectModules: false,
            ...(layout !== "beside" && extension === "vibe" ? { sidecarDir: layout } : {}) },
          [shape]: shape === "files" ? [source, declaration] : ["**/*"]
        }))
        const run = spawnSync(binary, ["-p", dir, "--pretty", "false"], { encoding: "utf8", timeout: 20000 })
        assert.ifError(run.error)
        const output = run.stdout + run.stderr
        results.push({
          exit: run.status,
          codes: [...output.matchAll(/(?:error|warning) ((?:TS|EK)\d+):/g)].map(m => m[1]).sort(),
          bytes: fs.readFileSync(path.join(dir, declaration))
        })
      }
      assert.equal(results[0].exit, shape === "files" ? 1 : 0, shape + " reference exit")
      assert.deepEqual(results[0].codes, shape === "files" ? ["TS5055"] : [], shape + " reference codes")
      assert.equal(results[0].bytes.equals(original), shape === "files", shape + " reference preservation")
      assert.deepEqual(results[1], results[0], layout + "/" + shape + " exit, diagnostic codes and on-disk bytes differ")
    }
  }
  console.log("sidecar overwrite parity")
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
