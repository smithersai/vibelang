import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { defaultCompiler, extract, linkModules, command } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")

test("the TestClock guide config runs the starter and deadline example", async () => {
  const temp = mkdtempSync(join(tmpdir(), "testclock-docs-"))
  const compiler = defaultCompiler()
  const run = async (args: string[], cwd: string) => {
    const result = await command(args, cwd, 60000)
    expect({ args, ...result, stdout: undefined }).toEqual({
      args, stdout: undefined, stderr: "", exitCode: 0, timedOut: false
    })
    return result.stdout
  }
  try {
    await run(["node", join(repo, "packages/create-vibelang/bin/create-vibelang.mjs"), "app", "--no-install"], temp)
    linkModules(temp)
    const app = join(temp, "app")
    const page = readFileSync(join(repo, "docs/user/src/testing/063-testclock.md"), "utf8")
    const blocks = extract(page)
    const config = blocks.find(block => block.filename === "vitest.config.ts")!
    expect(config).toBeDefined()
    writeFileSync(join(app, "vitest.config.ts"), config.source)
    const imports = new Set<string>()
    const body: string[] = []
    for (const block of [blocks.find(block => block.language === "vibe")!]) {
      for (const line of block.source.split("\n")) {
        if (line.startsWith("import ")) imports.add(line)
        else body.push(line)
      }
    }
    // Exercise the documented include at both the source root and a nested path.
    for (const filename of ["clock.test.vibe", "nested/clock.test.vibe"]) {
      const path = join(app, "src", filename)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, [...imports, ...body].join("\n"))
    }
    const originalBinary = process.env.VIBELANG_BINARY
    process.env.VIBELANG_BINARY = compiler
    try {
      const output = await run(["node", join(repo, "docs/tools/node_modules/vitest/vitest.mjs"), "run"], app)
      expect(output).toContain("4 passed")
    } finally {
      if (originalBinary === undefined) delete process.env.VIBELANG_BINARY
      else process.env.VIBELANG_BINARY = originalBinary
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}, 180000)
