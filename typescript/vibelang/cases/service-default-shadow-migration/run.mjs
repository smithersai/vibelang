// run-seconds: 180
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
for (const shadow of ["local", "import"]) {
  for (const indexed of [false, true]) {
    const dir = new URL("out/fix-" + shadow + "-" + indexed + "/", import.meta.url)
    mkdirSync(dir, { recursive: true })
    const source = "import { Flags } from './flags.vibe'\n" +
      (shadow === "local" ? "type ReturnType<T> = { wrong: true }\n" : "import type { ReturnType } from './shadow.vibe'\n") +
      "export type Read = " + (indexed ? '(typeof Flags)["default"]' : "typeof Flags.default") + "\n" +
      "export const same: Read extends Flags.Shape ? true : false = true\n" +
      "export const user: ReturnType<never> = { wrong: true }\n"
    const files = {
      "package.json": '{"type":"module"}',
      "flags.vibe": 'export service Flags { static readonly key = "rc40/Flags"; static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n',
      "shadow.vibe": "export type ReturnType<T> = { wrong: true }\n",
      "main.vibe": source,
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "compiled", rewriteRelativeImportExtensions: true }, files: ["main.vibe", "flags.vibe", "shadow.vibe"] }),
    }
    for (const [name, text] of Object.entries(files)) writeFileSync(new URL(name, dir), text)
    const args = ["-p", fileURLToPath(new URL("tsconfig.json", dir)), "--noEmit", "--pretty", "false"]
    const run = flags => {
      const result = spawnSync(compiler, [...args, ...flags], { encoding: "utf8" })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result.stdout + result.stderr
    }
    run([])
    const fixed = run(["--fix"])
    // VIP-9 preserves cached defaults; exported keys require an explained refusal.
    assert.match(fixed, /EK4855/)
    assert.match(fixed, /No automatic migration for an exported key/)
    for (const name of ["flags.vibe", "main.vibe", "shadow.vibe"]) {
      assert.equal(readFileSync(new URL(name, dir), "utf8"), files[name],
        "refusal must preserve " + name)
    }
    const main = readFileSync(new URL("main.vibe", dir), "utf8")
    assert(main.includes("export const user: ReturnType<never> = { wrong: true }"), main)
    assert(main.includes(indexed ? '(typeof Flags)["default"]' : "typeof Flags.default"), main)
    run([])
    run(["--fix"])
    assert.equal(readFileSync(new URL("main.vibe", dir), "utf8"), main)
  }
}
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
let sample = 0
fc.assert(fc.property(fc.constantFrom("local", "import"), fc.boolean(), fc.boolean(), (shadow, indexed, enabled) => {
  const dir = new URL("out/local-default-" + sample++ + "/", import.meta.url)
  mkdirSync(dir, { recursive: true })
  const utility = shadow === "local" ? "type ReturnType<T> = { wrong: true }\n"
    : "import type { ReturnType } from './shadow.vibe'\n"
  const source = utility +
    'service Flags { static readonly key = "defaults/Flags"; static readonly default: Flags.Shape = { enabled: ' + enabled + ' }; enabled: boolean }\n' +
    "export type Read = " + (indexed ? '(typeof Flags)["default"]' : "typeof Flags.default") + "\n" +
    "export const same: Read extends Flags.Shape ? true : false = true\n" +
    "export const user: ReturnType<never> = { wrong: true }\n"
  writeFileSync(new URL("package.json", dir), '{"type":"module"}')
  writeFileSync(new URL("main.vibe", dir), source)
  writeFileSync(new URL("shadow.vibe", dir), "export type ReturnType<T> = { wrong: true }\n")
  writeFileSync(new URL("tsconfig.json", dir), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true },
    files: ["main.vibe", "shadow.vibe"]
  }))
  const compile = (...flags) => {
    const result = spawnSync(compiler, ["-p", fileURLToPath(dir), "--noEmit", "--pretty", "false", ...flags],
      { encoding: "utf8", timeout: 30000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout + result.stderr
  }
  compile()
  compile("--fix")
  const fixed = readFileSync(new URL("main.vibe", dir), "utf8")
  assert.match(fixed, /class Flags extends /)
  assert.doesNotMatch(fixed, /defaultValue/)
  assert(fixed.includes("export const user: ReturnType<never> = { wrong: true }"), fixed)
  assert(fixed.includes(indexed ? '(typeof Flags)["default"]' : "typeof Flags.default"), fixed)
  compile()
  compile("--fix")
  assert.equal(readFileSync(new URL("main.vibe", dir), "utf8"), fixed)
}), { seed: 934, numRuns: 12 })
console.log("default migration preserves shadowed utility types")

