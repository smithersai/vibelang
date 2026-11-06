import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const skip = !existsSync(native) && "build the native compiler first"

function installed(t) {
  const root = mkdtempSync(join(tmpdir(), "vibe-installed-format-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, "node_modules")
  mkdirSync(modules)
  const compiler = join(modules, "vibelang")
  cpSync(join(repo, "packages/compiler"), compiler, {
    recursive: true, filter: path => !/\/(?:native|node_modules|test)$/.test(path) && !path.endsWith(".zip")
  })
  cpSync(join(repo, "packages/typescript-shim"), join(modules, "typescript"), {
    recursive: true, filter: path => !/\/(?:node_modules|test)$/.test(path)
  })
  symlinkSync(join(repo, "packages/compiler/node_modules"), join(compiler, "node_modules"))
  const target = process.platform === "win32" ? `@smthrs/cli-${process.platform}-${process.arch}` : `vibelang-${process.platform}-${process.arch}`
  const platform = join(modules, target)
  mkdirSync(join(platform, "bin"), { recursive: true })
  writeFileSync(join(platform, "package.json"), JSON.stringify({ name: target, version: "0.0.0" }))
  const binary = join(platform, "bin", process.platform === "win32" ? "vibelang.exe" : "vibelang")
  copyFileSync(native, binary)
  const plugin = spawnSync(binary, ["--write-dprint-plugin", compiler], { encoding: "utf8" })
  assert.equal(plugin.status, 0, plugin.stderr)
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"noEmit":true},"include":["main.ts"]}')
  return root
}

for (const fallback of [false, true]) {
  test(`installed shim supplies formatting through ${fallback ? "child-process fallback" : "native exec"}`, { skip }, async t => {
    const root = installed(t)
    const source = "// @vibe\nexport   const n = 1\n"
    const path = join(root, "main.ts")
    writeFileSync(path, source)
    const launcher = join(root, "node_modules/typescript/launcher.mjs")
    const script = `
      delete process.env.VIBELANG_BINARY;
      delete process.env.VIBELANG_FORMAT_MODULE;
      delete process.env.VIBELANG_FORMAT_NODE;
      if (${fallback}) process.execve = undefined;
      process.argv = [process.execPath, ${JSON.stringify(launcher)}, "--lsp", "--stdio"];
      await import(${JSON.stringify(pathToFileURL(launcher).href)});
    `
    const server = new Connection(process.execPath, ["--input-type=module", "-e", script], root, { requestTimeoutMs: 15_000 })
    t.after(async () => { server.process.kill("SIGKILL"); await server.exited })
    await server.request("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} })
    server.notify("initialized", {})
    const uri = pathToFileURL(path).href
    server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text: source } })
    const edits = await server.request("textDocument/formatting", { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } })
    const offset = p => source.split("\n").slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.character
    const result = edits.slice().sort((a, b) => offset(b.range.start) - offset(a.range.start)).reduce(
      (text, edit) => text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end)), source)
    assert.equal(result, "// @vibe\nexport const n = 1\n")
    assert.equal(readFileSync(path, "utf8"), source)
    await server.close()
  })
}
