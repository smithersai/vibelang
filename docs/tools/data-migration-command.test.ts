import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { command, defaultCompiler, linkModules } from "./check-snippets"

test("the Data migration command includes the fix driver it needs", async () => {
  const guide = readFileSync(new URL("../user/src/data-types/073-data.md", import.meta.url), "utf8")
  const invocation = guide.match(/this migration also runs with `([^`]+)`/)?.[1]
  expect(invocation).toBeDefined()
  const args = invocation!.split(/\s+/)
  if (args[0] === "vibelang") args.shift()
  const temp = mkdtempSync(join(tmpdir(), "data-migration-command-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"type":"module"}')
    writeFileSync(join(temp, "main.vibe"), "data Delivery { Waiting }\nexport const waiting = Delivery.Waiting()\n")
    writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", skipLibCheck: true, types: [], noEmit: true },
      files: ["main.vibe"]
    }))
    const result = await command([defaultCompiler(), ...args, "-p", "tsconfig.json", "--pretty", "false"], temp, 30000)
    expect(result.stdout + result.stderr).not.toContain("Unknown compiler option")
    expect(result.exitCode).toBe(0)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 30000)
