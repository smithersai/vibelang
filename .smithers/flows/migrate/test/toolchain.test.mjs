import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { licenseFiles, stageToolchain } from "../lib/toolchain.mjs"
import { must } from "../lib/util.mjs"

test("the staged npm package contains its dprint manifest's archive and canonical grammar", async t => {
  const root = mkdtempSync(join(tmpdir(), "vibe-toolchain-pack-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
  put("LICENSE", "MIT License\n\nCopyright (c) 2026 the VibeLang authors\n\nIN THE\nSOFTWARE.\n")
  put("typescript/LICENSE.txt", "Apache License\n")
  put("typescript/NOTICE.txt", "TypeScript notices\n")
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
  put("packages/unplugin/package.json", '{"name":"vibelang-unplugin","version":"0.0.0"}')
  put("editors/tree-sitter-vibelang/src/parser.c", "canonical parser")
  execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
  const out = join(root, "toolchain")
  const staged = await stageToolchain({ vibelang: root, out })
  const archive = path => execFileSync("tar", ["-xOzf", join(out, staged.packages.vibelang), "package/" + path], { encoding: "utf8" })
  const manifest = JSON.parse(archive("dprint-plugin.json"))
  assert.equal(archive(manifest["linux-x86_64"].reference), "formatter archive")
  assert.equal(archive("tree-sitter/parser.c"), "canonical parser")
})

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const built = [join(repo, "packages/compiler/native/vibelang"), join(repo, "packages/runtime/dist/index.js"), join(repo, "packages/runtime/node_modules/typescript")]
const skip = built.some((path) => !existsSync(path)) && "build the compiler and the runtime first (README: Run it)"

// t3code's web build lists each bundled package's license: a staged
// vibelang-runtime without one failed it.
test("a staged toolchain's tarballs carry the license files the published packages carry", { skip, timeout: 600000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), "migrate-toolchain-"))
  try {
    const toolchain = await stageToolchain({ vibelang: repo, out })
    const licenses = licenseFiles(repo)
    assert.match(licenses.mit.LICENSE, /^MIT License\n[\s\S]*SOFTWARE\.\n$/)
    assert.match(licenses.compiler.NOTICE, /modified version of the TypeScript compiler/)
    const entries = async (tarball) => (await must(`tar tzf ${JSON.stringify(join(out, tarball))}`)).stdout.split("\n")
    assert.ok((await entries(toolchain.packages["vibelang-runtime"])).includes("package/LICENSE"))
    assert.ok((await entries(toolchain.packages["vibelang-vite"])).includes("package/LICENSE"))
    const compiler = await entries(toolchain.packages.vibelang)
    assert.ok(compiler.includes("package/LICENSE") && compiler.includes("package/NOTICE"))
    assert.ok(!compiler.some((entry) => entry.includes("/test/")))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
