// #409: a package whose `files` allowlist names a converted module's .ts must
// publish its .vibe source after conversion. The test reads npm's own packed
// file list, not workspace resolution. Declaration sidecars stay out (VIP-27,
// lib/pack-policy.mjs): published types point at built .d.ts files.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { renameBatch, rewriteExports } from "../lib/codemod.mjs"
import { checkConvertedPaths } from "../lib/converted-paths.mjs"

const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-files-pack-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", JSON.stringify({ name: "files-pack", version: "1.0.0", type: "module", files, exports: { ".": "./dist/index.js" } }, null, 2) + "\n")
  put("src/index.ts", "export const answer = 42\n")
  put("src/util/helper.ts", "export const helper = 1\n")
  put("src/index.d.vibe.ts", "export declare const answer: number\n")
  put("dist/index.js", "export const answer = 42\n")
  put("notes.md", "unrelated\n")
  return { root, put }
}
const packed = root => JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", env: { ...process.env, npm_config_loglevel: "silent" } }))[0].files.map(f => f.path).sort()

for (const [name, files, renamed] of [
  ["a literal entry", ["src/index.ts", "dist"], "src/index"],
  ["a glob entry", ["src/**/*.ts", "dist", "!**/*.d.vibe.ts"], "src/util/helper"]
]) test("converting a module that " + name + " in files selects still publishes it as .vibe", t => {
  const { root } = fixture(t, files)
  const before = packed(root)
  assert.ok(before.includes(renamed + ".ts"))
  const renames = renameBatch(root, [renamed + ".ts"])
  rewriteExports(root, renames)
  const after = packed(root)
  assert.ok(after.includes(renamed + ".vibe"), JSON.stringify(after))
  assert.equal(after.includes(renamed + ".ts"), false)
  assert.equal(after.some(file => /\.d\.vibex?\.ts$/.test(file)), false, "sidecars stay out")
  // Every other packed file is unchanged.
  assert.deepEqual(after.filter(file => file !== renamed + ".vibe"), before.filter(file => file !== renamed + ".ts" && !/\.d\.vibex?\.ts$/.test(file)))
})

test("verify refuses a files entry that still selects only the converted .ts", () => {
  const manifest = JSON.stringify({ name: "files-pack", files: ["src/index.ts", "dist"] })
  const tree = { "package.json": manifest, "src/index.vibe": "export const answer = 42\n" }
  const result = checkConvertedPaths({ ts, tracked: Object.keys(tree), read: path => tree[path] })
  assert.deepEqual(result.refusals.map(r => [r.file, r.module]), [["package.json", "src/index.ts"]])
  const fixed = { ...tree, "package.json": JSON.stringify({ name: "files-pack", files: ["src/index.ts", "dist", "src/index.vibe"] }) }
  assert.deepEqual(checkConvertedPaths({ ts, tracked: Object.keys(fixed), read: path => fixed[path] }).refusals, [])
})
