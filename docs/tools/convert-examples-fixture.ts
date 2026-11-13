import { expect } from "bun:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { casesIn } from "../../.smithers/flows/convert/cases.mjs"
import { command, defaultCompiler, linkModules } from "./check-snippets"

const cases = () => casesIn(new URL("../../.smithers/flows/convert/examples/", import.meta.url).pathname)
const config = (language: string, options: Record<string, boolean> = {}) => JSON.stringify({
  compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [], skipLibCheck: true, outDir: "out", ...options },
  files: ["main." + language]
})

async function withExample(source: string, language: "vibe" | "ts", run?: string, options: Record<string, boolean> = {}) {
  const temp = mkdtempSync(join(tmpdir(), "convert-example-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"type":"module"}')
    writeFileSync(join(temp, "main." + language), source)
    writeFileSync(join(temp, "tsconfig.json"), config(language, options))
    const compiler = language === "vibe" ? [defaultCompiler(), "--singleThreaded"] : ["node", createRequire(import.meta.url).resolve("typescript/lib/tsc.js")]
    const compiled = await command([...compiler, "--pretty", "false", "-p", "tsconfig.json"], temp, 30000)
    expect(compiled.stdout + compiled.stderr).toBe("")
    expect(compiled.exitCode).toBe(0)
    if (run === undefined) return
    writeFileSync(join(temp, "observe.mjs"), run)
    const result = await command(["node", "observe.mjs"], temp, 30000)
    expect(result.stderr).toBe("")
    expect(result.exitCode).toBe(0)
    return result.stdout
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

export { expect, readFileSync, mkdtempSync, writeFileSync, rmSync, tmpdir, join, createRequire, casesIn, command, defaultCompiler, linkModules, cases, config, withExample }
