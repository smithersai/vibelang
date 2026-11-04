import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules } from "./check-snippets"
import { stage } from "./first-run-stage"

const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()
const forms = join(repo, "typescript/built/local/vibelang-forms")
const templates = readdirSync(join(repo, "templates"), { withFileTypes: true }).filter(entry => entry.isDirectory())
const expected: Record<string, string> = { app: "Hello, VibeLang!\nRecovered from EmptyName\n" }

// No skip on a missing compiler/runtime: the queue must build this checkout.
test("every template has an exact output contract", () => {
  expect(templates.map(entry => entry.name).sort()).toEqual(Object.keys(expected).sort())
})

for (const { name } of templates) {
  test(`starter ${name}: zero diagnostics, zero legacy sites, exact main output and tests`, async () => {
    const temp = mkdtempSync(join(tmpdir(), "starter-forms-"))
    try {
      linkModules(temp)
      const app = join(temp, name)
      cpSync(join(repo, "templates", name), app, { recursive: true, filter: path =>
        !["node_modules", "dist", ".vibelang"].includes(path.split("/").at(-1)!) && !path.endsWith(".d.vibe.ts") })
      const run = async (args: string[]) => {
        const result = await stage(args, { cwd: app, env: { ...process.env, VIBELANG_BINARY: compiler } })
        expect({ args, exitCode: result.exitCode, failure: result.failure, stderr: result.stderr })
          .toEqual({ args, exitCode: 0, failure: "", stderr: "" })
        return result.stdout
      }
      // The test config includes the test sources, which the production build excludes.
      expect(await run([compiler, "-p", "tsconfig.test.json", "--pretty", "false"])).toBe("")
      expect(await run([forms, "-legacy", "tsconfig.test.json", "-compiler", compiler])).toBe("0 legacy sites\n")
      expect(await run(["node", "--enable-source-maps", "dist/main.js"])).toBe(expected[name])
      const tests = await run(["node", join(repo, "docs/tools/node_modules/vitest/vitest.mjs"), "run"])
      expect(tests).toContain("2 passed")

      if (name === "app") {
        const main = join(app, "src/main.vibe")
        const current = readFileSync(main, "utf8")
        // Native negative controls: neither retired syntax nor warnings may pass.
        const controls = [
          current.replace('try greeter.greet("VibeLang")', 'try Greeter.greet("VibeLang")'),
          current.replace('greeter.greet("") catch effect (error) => {', 'try { try greeter.greet("") } catch (error) {'),
          current + "\nconst legacy: Effect<number> = succeed(1)\n",
          current + '\neffect function aliasCall() { const alias = Greeter; return try alias.greet("Ada") }\n',
        ]
        for (const [index, source] of controls.entries()) {
          expect(source).not.toBe(current)
          writeFileSync(main, source)
          if (index === 2) {
            const warning = await stage([compiler, "-p", "tsconfig.test.json", "--noEmit", "--pretty", "false"], { cwd: app })
            expect(warning.exitCode).toBe(0)
            expect(warning.stdout + warning.stderr).toContain("EK4856")
          }
          const rejected = await stage([forms, "-legacy", "tsconfig.test.json", "-compiler", compiler], { cwd: app })
          expect(rejected.exitCode, "legacy control " + index + ": " + rejected.stderr).not.toBe(0)
          expect(rejected.stderr).toContain("zero diagnostics")
        }
        writeFileSync(main, current + '\nfunction ordinary() { try { return 1 } catch { return 0 } }\nconst text = "try Greeter.greet and try { } catch";\n')
        expect(await run([forms, "-legacy", "tsconfig.test.json", "-compiler", compiler])).toBe("0 legacy sites\n")
      }
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }, 180_000)
}
