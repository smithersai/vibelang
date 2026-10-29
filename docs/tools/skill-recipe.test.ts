import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()

test.skipIf(!existsSync(compiler))("the shipped skill's config/file recipe runs with a default and cleans up", async () => {
  const skill = readFileSync(join(repo, "packages/compiler/skills/vibelang/SKILL.md"), "utf8")
  const recipe = [...skill.matchAll(/^```vibe\n([\s\S]*?)^```/gm)]
    .find(match => match[1].includes("Config.withDefault"))?.[1]
  expect(recipe).toBeDefined()
  // The recipe is in the VIP language and waits for the VIPs its pending line
  // names; it runs here once that line goes.
  if (/^\/\/ pending:/m.test(recipe!)) return
  const root = mkdtempSync(join(tmpdir(), "vibelang-skill-recipe-"))
  const command = async (args: string[], env = process.env) => {
    const child = Bun.spawn(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect({ args, exitCode, stderr }).toEqual({ args, exitCode: 0, stderr: "" })
    return stdout.trim()
  }
  try {
    linkModules(root)
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "main.vibe"), recipe!)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "dist" },
      include: ["main.vibe"]
    }))
    await command([compiler, "-p", "."])
    const temporary = join(root, "temporary")
    mkdirSync(temporary)
    const env = { ...process.env, TMPDIR: temporary }
    delete env.NAME
    expect(await command(["node", "dist/main.js"], env)).toBe("Hello, stranger!")
    expect(readdirSync(temporary)).toEqual([])
    expect(await command(["node", "dist/main.js"], { ...env, NAME: "Ada" })).toBe("Hello, Ada!")
    expect(readdirSync(temporary)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30000)
