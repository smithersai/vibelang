import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { command, defaultCompiler, extract, runtimeDir, writeProject } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")

test("the browser entry guide compiles and runs its crypto program", async () => {
  const text = readFileSync(join(repo, "docs/user/src/platform/105-introduction.md"), "utf8")
  const browser = text.split("## Starting `main` in a browser")[1]!.split("## Coming from Effect")[0]!
  const blocks = extract(browser).map(block => ({ ...block, pending: undefined, fragment: false }))
  expect(blocks.map(block => block.filename)).toEqual(["app.vibe", "page.vibe"])
  const temp = mkdtempSync(join(tmpdir(), "browser-entry-guide-"))
  try {
    // Keep crypto keys and their services in one physical Effect installation.
    const modules = join(temp, "node_modules")
    mkdirSync(join(modules, "@effect"), { recursive: true })
    for (const name of ["effect", "@effect/platform-browser"]) {
      cpSync(realpathSync(join(import.meta.dir, "node_modules", name)), join(modules, name), { recursive: true })
    }
    symlinkSync(realpathSync(join(import.meta.dir, "node_modules/@effect/platform-node")), join(modules, "@effect/platform-node"))
    symlinkSync(runtimeDir(), join(modules, "vibelang-runtime"))
    const dir = join(temp, "program")
    writeProject(dir, blocks)
    const compiled = await command([defaultCompiler(), "--pretty", "false", "-p", "tsconfig.json", "--noEmit", "false", "--outDir", "dist"], dir, 60000)
    expect({ status: compiled.exitCode, output: compiled.stdout + compiled.stderr }).toEqual({ status: 0, output: "" })
    // Supply the page lifecycle API; Node's WebCrypto runs the browser crypto layer.
    writeFileSync(join(dir, "host.mjs"), [
      "const page = new EventTarget()",
      "globalThis.addEventListener = page.addEventListener.bind(page)",
      "globalThis.removeEventListener = page.removeEventListener.bind(page)",
      'await import("./dist/page.js")'
    ].join("\n"))
    const result = await command(["node", "host.mjs"], dir, 10000)
    expect({ status: result.exitCode, stdout: result.stdout.trim(), stderr: result.stderr }).toEqual({ status: 0, stdout: "32", stderr: "" })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}, 90000)
