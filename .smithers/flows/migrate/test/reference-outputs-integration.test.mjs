import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { compile, makeConfig, paths } from "../lib/steps.mjs"
import { slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const skip = !existsSync(binary) && "build the native compiler"

test("migration compile refreshes stale dependent outputs after a source rename", { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-reference-compile-")), target = join(root, "repo")
  const put = (file, text) => {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    writeFileSync(join(target, file), typeof text === "string" ? text : JSON.stringify(text))
  }
  try {
    put("package.json", { type: "module", private: true })
    put(".gitignore", "node_modules/\n**/lib/\n**/types/\n**/cache/\n**/*.d.vibe.ts\n")
    put("tsconfig.json", { files: [], references: [{ path: "p2" }] })
    put("base.json", { compilerOptions: { composite: true, declaration: true, target: "ESNext", module: "ESNext", types: [] },
      vibe: { effectGlobals: false, effectModules: false } })
    for (let i = 0; i < 3; i++) {
      put("p" + i + "/tsconfig.json", { extends: "../base.json", compilerOptions: {
        rootDir: "src", outDir: "lib", declarationDir: "types", tsBuildInfoFile: "cache/build.tsbuildinfo" },
        include: ["src"], references: i ? [{ path: "../p" + (i - 1) }] : [] })
      put("p" + i + "/src/main.ts", "export const value = 1\n")
      for (const output of ["lib/main.js", "types/main.d.ts", "cache/build.tsbuildinfo"]) put("p" + i + "/" + output, "stale")
    }
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(binary, join(target, "node_modules/.bin/vibelang"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    const init = spawnSync("jj", ["git", "init", target], { encoding: "utf8" })
    assert.equal(init.status, 0, init.stderr)
    renameSync(join(target, "p0/src/main.ts"), join(target, "p0/src/main.vibe"))
    const p = paths(join(root, "run"))
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.setup, {})
    writeJson(p.plan, { batches: [{ files: ["p0/src/main.ts"] }] })
    writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
    const result = await compile({ run: p.run, batch: "01" })
    assert.equal(result.summary.errors, 0)
    for (let i = 0; i < 3; i++) {
      assert.match(readFileSync(join(target, "p" + i + "/lib/main.js"), "utf8"), /export const value = 1/)
      assert.match(readFileSync(join(target, "p" + i + "/types/main.d.ts"), "utf8"), /export declare const value = 1/)
      assert.doesNotMatch(readFileSync(join(target, "p" + i + "/cache/build.tsbuildinfo"), "utf8"), /^stale$/)
    }
    assert.equal(result.referenceRefresh.state, "complete")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
