import assert from "node:assert/strict"
import { test } from "node:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { stageToolchain } from "../lib/toolchain.mjs"
test("the staged npm package contains its dprint manifest's archive and canonical grammar", async t => {
  const root = mkdtempSync(join(tmpdir(), "vibe-toolchain-pack-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
  put("packages/compiler/package.json", JSON.stringify({ name: "vibelang", version: "0.0.0", files: ["dprint-plugin.json"] }))
  put("packages/compiler/native/vibelang", `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const root = process.argv[3]
fs.writeFileSync(path.join(root, "dprint-plugin.json"), JSON.stringify({"linux-x86_64": {reference: "native/plugin.zip"}}))
fs.writeFileSync(path.join(root, "native/plugin.zip"), "formatter archive")
`)
  chmodSync(join(root, "packages/compiler/native/vibelang"), 0o755)
  put("packages/runtime/package.json", JSON.stringify({ name: "vibelang-runtime", version: "0.0.0", peerDependencies: { effect: "4.0.6" }, files: ["dist"] }))
  put("packages/runtime/dist/index.js", "export {}")
  put("packages/runtime/node_modules/typescript/package.json", '{"name":"typescript","version":"5.9.3"}')
  put("packages/vite/package.json", '{"name":"vibelang-vite","version":"0.0.0"}')
  put("editors/tree-sitter-vibelang/src/parser.c", "canonical parser")
  execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
  const out = join(root, "toolchain")
  const staged = await stageToolchain({ vibelang: root, out })
  const archive = path => execFileSync("tar", ["-xOzf", join(out, staged.packages.vibelang), "package/" + path], { encoding: "utf8" })
  const manifest = JSON.parse(archive("dprint-plugin.json"))
  assert.equal(archive(manifest["linux-x86_64"].reference), "formatter archive")
  assert.equal(archive("tree-sitter/parser.c"), "canonical parser")
})
