import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import fc from "fast-check"
import { defaultCompiler, extract, linkModules } from "./check-snippets"
import { blockDeadline, runTestLimit } from "./run-snippets"

const homepage = readFileSync(join(import.meta.dir, "../../site/src/pages/index.mdx"), "utf8")

// Execute the displayed source without a synthetic entry call. Such a call
// would hide a copyable example that constructs an Effect but never runs it.
async function greeting(source: string, language: "vibe" | "ts", expected: string) {
  const temp = mkdtempSync(join(tmpdir(), "docs-greeting-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(temp, "main." + language), source)
    writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "dist", noEmitOnError: true },
      files: ["main." + language],
    }))
    const compile = Bun.spawn([defaultCompiler(), "-p", "tsconfig.json"], { cwd: temp, stdout: "pipe", stderr: "pipe", timeout: blockDeadline })
    const [stdout, stderr, code] = await Promise.all([new Response(compile.stdout).text(), new Response(compile.stderr).text(), compile.exited])
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" })
    const run = Bun.spawn(["node", "dist/main.js"], { cwd: temp, stdout: "pipe", stderr: "pipe", timeout: blockDeadline })
    const [output, errors, exitCode] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
    expect({ exitCode, output, errors }).toEqual({ exitCode: 0, output: expected + "\n", errors: "" })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

for (const language of ["vibe", "ts"] as const) {
  const example = extract(homepage).find(block => block.language === language && block.source.includes("interface User {"))
  test("the homepage " + language + " greeting executes when copied", async () => {
    expect(example).toBeDefined()
    await greeting(example!.source, language, "Hello, Ada")
  }, runTestLimit)

  test("the homepage " + language + " greeting runs once across generated user names", async () => {
    expect(example).toBeDefined()
    await fc.assert(fc.asyncProperty(fc.string({ unit: "grapheme", maxLength: 16 }), async name => {
      expect(example!.source).toContain('name: "Ada"')
      // A replacer function: a string replacement would read $$, $& and $1 in the generated name as patterns.
      await greeting(example!.source.replace('name: "Ada"', () => "name: " + JSON.stringify(name)), language, "Hello, " + name)
    }), { numRuns: 8, examples: [[""], ["Ada"], ["line\nbreak"], ['quote"slash\\'], ["$$ and $& and $1"]] })
  }, runTestLimit)

  test("the homepage " + language + " greeting runs its missing-user fallback", async () => {
    expect(example).toBeDefined()
    const success = language === "vibe"
      ? 'find: effect (id: string) => ({ id, name: "Ada" })'
      : 'find: (id: string) => Effect.succeed({ id, name: "Ada" })'
    const failure = language === "vibe"
      ? "find: effect (id: string) => { throw new UserNotFound({ id }) }"
      : "find: (id: string) => Effect.fail(new UserNotFound({ id }))"
    expect(example!.source).toContain(success)
    await greeting(example!.source.replace(success, failure), language, "Hello, guest")
  }, runTestLimit)
}
