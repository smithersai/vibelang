import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules } from "./check-snippets"
import { stage } from "./first-run-stage"

const repo = resolve(import.meta.dir, "../..")
const source = readFileSync(join(repo, "site/videos/starter-test/greeting.test.vibe"), "utf8")

test("the recorded starter tests run with generated names on the native compiler", async () => {
  await fc.assert(fc.asyncProperty(
    fc.string({ minLength: 1, maxLength: 16 }),
    async name => {
      const temp = mkdtempSync(join(tmpdir(), "starter-recording-test-"))
      const command = async (args: string[], cwd: string) => {
        const result = await stage(args, { cwd, env: { ...process.env, VIBELANG_BINARY: defaultCompiler(), CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" } })
        expect({ args, exitCode: result.exitCode, failure: result.failure, stderr: result.stderr })
          .toEqual({ args, exitCode: 0, failure: "", stderr: result.stderr })
        return result.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      }
      try {
        await command(["node", join(repo, "packages/create-vibelang/bin/create-vibelang.mjs"), "app", "--no-install"], temp)
        linkModules(temp)
        const app = join(temp, "app")
        const generated = source.replace('greeting("Ada")', () => "greeting(" + JSON.stringify(name) + ")")
          .replace('"Hello, Ada!"', () => JSON.stringify("Hello, " + name + "!"))
        writeFileSync(join(app, "src/greeting.test.vibe"), generated)
        const output = await command(["node", join(repo, "docs/tools/node_modules/vitest/vitest.mjs"), "run"], app)
        expect(output).toMatch(/Tests\s+2 passed/)
      } finally { rmSync(temp, { recursive: true, force: true }) }
    },
  ), { numRuns: 12, examples: [["Ada"], ["$&"], ['a\nb"c'], ["雪"], [" "]] })
  // Measured 2026-11-12: 52.0 s and 63.4 s alone on a quiet 4-vCPU box, and 60 s timeouts under load in the
  // 0.0.13 release trains. A limit inside its own run time fails at random, so this one is about three times
  // the slowest quiet run.
}, 180_000)
