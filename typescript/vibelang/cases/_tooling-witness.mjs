// Shared temp-project driver for the chapter 7 tooling witnesses.
// Each case's run.mjs imports it; the harness supplies VIBELANG_BINARY,
// EFFECT_NODE_MODULES and VIBELANG_RUNTIME.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

export const stockTsc = new URL("../../../docs/tools/node_modules/typescript/bin/tsc", import.meta.url).pathname

// project(action) runs action(ctx) in a fresh directory with effect and
// vibelang-runtime installed, then removes the directory.
export function project(action) {
  const dir = mkdtempSync(join(tmpdir(), "tooling-witness-"))
  try {
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
    symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    const put = (file, text) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), typeof text === "string" ? text : JSON.stringify(text, null, 2))
    }
    const read = file => readFileSync(join(dir, file), "utf8")
    const exists = file => existsSync(join(dir, file))
    const run = (command, args, cwd = dir) => {
      const r = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60000 })
      assert.ifError(r.error)
      assert.equal(r.signal, null, command + " " + args.join(" ") + " was killed")
      return { ...r, text: r.stdout + r.stderr }
    }
    // invoke(...args) runs the compiler under test in the project directory.
    const invoke = (...args) => run(process.env.VIBELANG_BINARY, args)
    // stock(...args) runs the pinned stock TypeScript for twin comparisons.
    const stock = (...args) => run(process.execPath, [stockTsc, ...args])
    return action({ dir, put, read, exists, run, invoke, stock })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// The base compiler options most witnesses start from.
export const baseOptions = () => ({ strict: true, types: [], skipLibCheck: true, target: "ES2022", module: "NodeNext", outDir: "out" })

// diagnostics(text) lists "category CODE" for each printed diagnostic, in order.
export const diagnostics = text => [...text.matchAll(/\b(error|warning|suggestion|message) ((?:EK|TS)\d+)\b/g)].map(m => m[1] + " " + m[2])
export const codes = text => diagnostics(text).map(d => d.split(" ")[1])
