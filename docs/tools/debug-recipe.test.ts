import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, extract, linkModules } from "./check-snippets"

test.skipIf(!existsSync(defaultCompiler()))("the documented debugging entry works with starter types and keeps a failing source-mapped exit", async () => {
  const docsRoot = process.env.DOCS_CONTRACT_ROOT || resolve(import.meta.dir, "../..")
  const page = readFileSync(join(docsRoot, "docs/user/src/getting-started/012-devtools.md"), "utf8")
  const entry = extract(page).find(block => block.filename === "debug.ts")
  expect(entry, "the debugging recipe must be present").toBeDefined()
  const dir = mkdtempSync(join(tmpdir(), "debug-recipe-"))
  const run = async (args: string[]) => {
    const child = Bun.spawn(args, { cwd: dir, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { stdout, stderr, code }
  }
  try {
    linkModules(dir)
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    writeFileSync(join(dir, "debug.ts"), entry!.source)
    // The page imports the application from app.vibe. This fixture is written for the
    // compiler that is shipped; give it the VIP form when the compiler implements VIP-1.
    writeFileSync(join(dir, "app.vibe"), 'export function main() {\n  sleep("1 millis")\n  sync(() => { throw new Error("DEBUG_RECIPE_MARKER") })\n}\n')
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        types: [], skipLibCheck: true, sourceMap: true, outDir: "dist", rewriteRelativeImportExtensions: true },
      include: ["*.ts", "*.vibe"]
    }))
    const compile = await run([defaultCompiler(), "-p", join(dir, "tsconfig.json")])
    expect(compile).toMatchObject({ code: 0, stderr: "" })
    const executed = await run(["node", "--enable-source-maps", "dist/debug.js"])
    expect(executed.code).toBe(1)
    expect(executed.stderr).toContain("DEBUG_RECIPE_MARKER")
    expect(executed.stderr).toContain("app.vibe:3")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
