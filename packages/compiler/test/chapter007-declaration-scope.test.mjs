import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const stock = join(repo, "docs/tools/node_modules/typescript/bin/tsc")

// Chapter 007 / declaration settings leave JavaScript and source-sidecar identity intact: docs/design/src/007-tooling.md#65feda23da8922f1
test("Chapter 007 / package declaration styles do not leak into JavaScript or adjacent sidecars", t => {
  const root = mkdtempSync(join(tmpdir(), "chapter007-declaration-scope-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(JSON.parse(readFileSync(join(repo, "docs/tools/node_modules/typescript/package.json"), "utf8")).version, "5.9.3")
  const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, types: [], declaration: true, rootDir: "src", outDir: "out" }
  function prepare(dir, extension, specifier) {
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    writeFileSync(join(dir, "src/leaf." + extension), "export const value = 42\n")
    writeFileSync(join(dir, "src/main." + extension), 'export { value } from "' + specifier + '"\n')
  }
  function command(executable, args, cwd) {
    const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 90000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout.trim()
  }
  const native = join(root, "native")
  prepare(native, "ts", "./leaf.js")
  writeFileSync(join(native, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["src/main.ts", "src/leaf.ts"] }))
  command(process.execPath, [stock, "-p", ".", "--pretty", "false"], native)
  const run = dir => command(process.execPath, ["--input-type=module", "-e",
    'import { value } from "./out/main.js"; console.log(JSON.stringify(value))'], dir)
  assert.equal(run(native), "42")
  for (const style of [".js", "extensionless", ".ts"]) {
    const dir = join(root, style === "extensionless" ? "bare" : style.slice(1))
    prepare(dir, "vibe", "./leaf.vibe")
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: options,
      files: ["src/main.vibe", "src/leaf.vibe"], vibe: { effectGlobals: false, effectModules: false },
      vibelang: { declarationImportStyle: style } }))
    command(binary, ["-p", ".", "--pretty", "false"], dir)
    assert.match(readFileSync(join(dir, "out/main.js"), "utf8"), /from ["']\.\/leaf\.js["']/)
    assert.match(readFileSync(join(dir, "src/main.d.vibe.ts"), "utf8"), /from ["']\.\/leaf\.vibe["']/)
    const suffix = style === "extensionless" ? "" : style
    assert.ok(readFileSync(join(dir, "out/main.d.ts"), "utf8").includes('"./leaf' + suffix + '"'))
    assert.equal(run(dir), run(native), style + " must preserve the ordinary module result")
  }
})
