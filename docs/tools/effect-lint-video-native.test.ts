import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules } from "./check-snippets"
import { stage } from "./first-run-stage"

const fixtures = resolve(import.meta.dir, "../../site/videos/effect-lint")
test("the project-based lint example warns about Promise success data and runs its correction", async () => {
  // VIP-38: lint uses compiler project options and plugin activation; the
  // normative Promise success-channel warning is EK3897.
  await fc.assert(fc.asyncProperty(fc.integer({ min: -1000, max: 1000 }), fc.constantFrom("tsconfig.json", "lint-project.json"), fc.boolean(), async (value, project, longOption) => {
    const temp = mkdtempSync(join(tmpdir(), "effect-lint-example-"))
    const command = (args: string[]) => stage(args, { cwd: temp, env: { ...process.env, VIBELANG_BINARY: defaultCompiler() } })
    try {
      linkModules(temp)
      mkdirSync(join(temp, "src"))
      writeFileSync(join(temp, "package.json"), '{"private":true,"type":"module"}')
      writeFileSync(join(temp, project), JSON.stringify(JSON.parse(readFileSync(join(fixtures, "tsconfig.json"), "utf8")), null, longOption ? 2 : undefined))
      const projectOption = longOption ? "--project" : "-p"
      writeFileSync(join(temp, "src/pending.ts"), "export const pending = Promise.resolve(" + value + ")\n")
      const file = join(temp, "src/main.vibe")
      writeFileSync(file, readFileSync(join(fixtures, "before.vibe"), "utf8").replace("Effect.succeed(pending)", "Effect.succeed((pending))"))
      const warned = await command([defaultCompiler(), "lint", projectOption, project])
      expect(warned.exitCode).toBe(0)
      expect(warned.stdout + warned.stderr).toContain("EK3897")
      writeFileSync(file, readFileSync(join(fixtures, "after.vibe")))
      const clean = await command([defaultCompiler(), "lint", projectOption, project])
      expect(clean.exitCode).toBe(0)
      expect(clean.stdout + clean.stderr).not.toContain("EK3897")
      expect((await command([defaultCompiler(), projectOption, project])).exitCode).toBe(0)
      const ran = await command(["node", "--input-type=module", "-e", 'import {Effect} from "effect"; import {program} from "./dist/main.js"; console.log(await Effect.runPromise(program))'])
      expect(ran.exitCode).toBe(0)
      expect(ran.stdout.trim()).toBe(String(value))
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }), { numRuns: 8, examples: [[1, "tsconfig.json", false], [0, "lint-project.json", true], [-1, "lint-project.json", false]] })
}, 120_000)
