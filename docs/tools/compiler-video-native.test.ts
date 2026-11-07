import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules } from "./check-snippets"
import { stage } from "./first-run-stage"

const repo = resolve(import.meta.dir, "../..")
const before = readFileSync(join(repo, "site/videos/compiler-feedback/before.vibe"), "utf8")
const after = readFileSync(join(repo, "site/videos/compiler-feedback/after.vibe"), "utf8")

test("the recorded feedback rejects discarded Effects and runs their correction", async () => {
  await fc.assert(fc.asyncProperty(
    fc.stringMatching(/^[A-Za-z]{1,16}$/),
    async name => {
      const temp = mkdtempSync(join(tmpdir(), "compiler-recording-test-"))
      const command = (args: string[], cwd: string) =>
        stage(args, { cwd, env: { ...process.env, VIBELANG_BINARY: defaultCompiler() } })
      try {
        const created = await command(["node", join(repo, "packages/create-vibelang/bin/create-vibelang.mjs"), "app", "--no-install"], temp)
        expect(created.exitCode).toBe(0)
        linkModules(temp)
        const app = join(temp, "app")
        const file = join(app, "src/main.vibe")
        const variant = (text: string) => text.replace('"Hello, Ada!"', JSON.stringify("Hello, " + name + "!"))
        writeFileSync(file, variant(before))
        const rejected = await command([defaultCompiler(), "--noEmit"], app)
        expect([1, 2]).toContain(rejected.exitCode)
        expect(rejected.signalCode).toBe(null)
        expect(rejected.stdout + rejected.stderr).toContain("EK4801")
        writeFileSync(file, variant(after))
        const built = await command([defaultCompiler()], app)
        expect(built.exitCode).toBe(0)
        const ran = await command(["node", "--enable-source-maps", "dist/main.js"], app)
        expect(ran.exitCode).toBe(0)
        expect(ran.stdout.trim()).toBe("Hello, " + name + "!")
      } finally { rmSync(temp, { recursive: true, force: true }) }
    },
  ), { numRuns: 4, examples: [["Ada"]] })
}, 60_000)
