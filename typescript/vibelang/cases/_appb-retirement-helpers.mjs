// Shared fixture for the Appendix B retirement-row witnesses (appb-*): a
// temporary project beside the case's node_modules, the case's compiler,
// and a runner that prints the JSON of main()'s success value.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const options = { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", declaration: true }

export function withProject(here, files, action, config = { compilerOptions: options, include: ["*.vibe"] }) {
  const compiler = process.env.VIBELANG_BINARY ?? resolve(here, "../../../built/local/tsc")
  const dir = mkdtempSync(join(tmpdir(), "appb-"))
  try {
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
    const tsc = (...args) => {
      const r = spawnSync(compiler, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8", timeout: 120000 })
      assert.ifError(r.error)
      return { status: r.status, text: r.stdout + r.stderr }
    }
    const read = (name) => readFileSync(join(dir, name), "utf8")
    const write = (name, text) => writeFileSync(join(dir, name), text)
    const run = () => {
      writeFileSync(join(dir, "run.mjs"), 'import { Effect } from "effect"; import { main } from "./out/main.js"; console.log(JSON.stringify(await Effect.runPromise(main())))')
      const r = spawnSync(process.execPath, [join(dir, "run.mjs")], { encoding: "utf8", timeout: 30000 })
      assert.ifError(r.error)
      assert.equal(r.status, 0, r.stdout + r.stderr)
      return r.stdout.trim()
    }
    return action({ dir, tsc, read, write, run })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// codes lists the diagnostic codes in compiler output, in order.
export const codes = (text) => [...text.matchAll(/\b(?:error|warning) ((?:EK|TS)\d+)/g)].map((m) => m[1])
