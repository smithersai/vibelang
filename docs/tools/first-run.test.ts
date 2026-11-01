import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules, normalizeOutput } from "./check-snippets"
import { sectionBlocks } from "./check-smithers-content"
import { STAGE_MS, stage } from "./first-run-stage"

// The commands the check runs, each with its own STAGE_MS deadline (first-run-stage.ts).
const STAGES = 5

const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()

test.skipIf(!existsSync(compiler))("the local starter runs and its stdout matches the first-run guides", async () => {
  const temp = mkdtempSync(join(tmpdir(), "docs-first-run-"))
  const command = async (args: string[], cwd = temp) => {
    const result = await stage(args, { cwd, env: { ...process.env, VIBELANG_BINARY: compiler } })
    const { exitCode, signalCode, failure } = result
    expect({ args, exitCode, signalCode, failure }).toEqual({ args, exitCode: 0, signalCode: null, failure: "" })
    return result.stdout
  }
  try {
    // Generate the same files as npm/bun create, without registry installs.
    await command(["node", join(repo, "packages/create-vibelang/bin/create-vibelang.mjs"), "app", "--no-install"])
    linkModules(temp)
    const app = join(temp, "app")
    // The Vite plugin must be able to check and emit a new, unbuilt app.
    const tests = await command(["node", join(repo, "docs/tools/node_modules/vitest/vitest.mjs"), "run"], app)
    expect(tests).toContain("2 passed")
    const version = await command([compiler, "--version"], app)
    const existingProject = readFileSync(join(repo, "docs/user/src/setup/existing-project.md"), "utf8")
    const expectedVersion = sectionBlocks(existingProject, "3. Check the compiler", "out")
    expect(expectedVersion).toHaveLength(1)
    expect(normalizeOutput(version)).toBe(expectedVersion[0])
    await command([compiler, "-p", "tsconfig.json"], app)
    const stdout = await command(["node", "--enable-source-maps", "dist/main.js"], app)
    for (const page of ["013-getting-started.md", "getting-started/004-installation.md", "setup/new-project.md"]) {
      const markdown = readFileSync(join(repo, "docs/user/src", page), "utf8")
      const outputs = page === "setup/new-project.md"
        ? sectionBlocks(markdown, "2. Build and run", "out")
        : [...markdown.matchAll(/^```out\r?\n([\s\S]*?)\r?\n```/gm)].map(match => match[1])
      expect({ page, outputs: outputs.length }).toEqual({ page, outputs: 1 })
      expect({ page, stdout: normalizeOutput(stdout) }).toEqual({ page, stdout: normalizeOutput(outputs[0]) })
    }
    const newProject = readFileSync(join(repo, "docs/user/src/setup/new-project.md"), "utf8")
    const expectedTests = sectionBlocks(newProject, "3. Run the tests", "out")
    expect(expectedTests).toHaveLength(1)
    const summary = tests.replace(/\x1b\[[0-9;]*m/g, "").match(/ Test Files[^\n]+\n[^\n]*Tests[^\n]+/)?.[0]
    expect(summary?.trimStart()).toBe(expectedTests[0])
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, STAGES * STAGE_MS)
