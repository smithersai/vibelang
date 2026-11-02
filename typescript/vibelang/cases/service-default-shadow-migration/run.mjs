import assert from "node:assert/strict"
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
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "compiled" }, files: ["main.vibe", "flags.vibe", "shadow.vibe"] }),
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
    assert(!fixed.includes("fixes refused"), fixed)
    assert(readFileSync(new URL("flags.vibe", dir), "utf8").includes("defaultValue"), fixed)
    const main = readFileSync(new URL("main.vibe", dir), "utf8")
    assert(main.includes("export const user: ReturnType<never> = { wrong: true }"), main)
    assert(!main.includes('["default"]') && !main.includes(".default\n"), main)
    run([])
    run(["--fix"])
    assert.equal(readFileSync(new URL("main.vibe", dir), "utf8"), main)
  }
}
console.log("default migration preserves shadowed utility types")
