import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, extract, linkModules, normalizeOutput } from "./check-snippets"
import { STAGE_MS, stage } from "./first-run-stage"

// The first complete programs a reader copies must run as copied. VIP-26
// gives a module no magic entry point, so each listing starts its own main.
// This check pastes each listing, unchanged, into a fresh starter's
// src/main.vibe, builds it and runs `node dist/main.js`, with no harness.
const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()
const PAGES = ["001-onboarding.md", "013-getting-started.md"]

const listing = (page: string) => {
  const blocks = extract(readFileSync(join(repo, "docs/user/src", page), "utf8"))
    .filter(block => block.language === "vibe" && /\beffect function main\(/.test(block.source))
  expect({ page, listings: blocks.length }).toEqual({ page, listings: 1 })
  return blocks[0]
}

test("the first complete programs carry their own runner, not a hidden run line", () => {
  for (const page of PAGES) {
    const block = listing(page)
    expect({ page, run: block.run }).toEqual({ page, run: undefined })
    expect(block.source).toMatch(/^NodeRuntime\.runMain\(main\(\)\)$/m)
    expect(block.output).toBeTruthy()
  }
})

test.skipIf(!existsSync(compiler))("the first complete programs print their documented output when copied into the starter", async () => {
  const temp = mkdtempSync(join(tmpdir(), "docs-first-programs-"))
  const command = async (args: string[], cwd = temp) => {
    const result = await stage(args, { cwd, env: { ...process.env, VIBELANG_BINARY: compiler } })
    const { exitCode, signalCode, failure } = result
    expect({ args, exitCode, signalCode, failure, stderr: exitCode ? result.stderr : "" }).toEqual({ args, exitCode: 0, signalCode: null, failure: "", stderr: "" })
    return result.stdout
  }
  try {
    await command(["node", join(repo, "packages/create-vibelang/bin/create-vibelang.mjs"), "app", "--no-install"])
    linkModules(temp)
    const app = join(temp, "app")
    for (const page of PAGES) {
      const block = listing(page)
      // The listing exactly as the page shows it, directive lines included.
      writeFileSync(join(app, "src/main.vibe"), block.source + "\n")
      await command([compiler, "-p", "tsconfig.json"], app)
      const stdout = await command(["node", "dist/main.js"], app)
      expect({ page, stdout: normalizeOutput(stdout) }).toEqual({ page, stdout: normalizeOutput(block.output!) })
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 4 * STAGE_MS)
