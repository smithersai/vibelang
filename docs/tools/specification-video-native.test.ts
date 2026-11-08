import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, linkModules } from "./check-snippets"
import { stage } from "./first-run-stage"
import { examples } from "../../site/scripts/record-specification.mjs"

const repo = resolve(import.meta.dir, "../..")
test("specification recording examples compile and execute across generated payloads", async () => {
  const rule = readFileSync(resolve(repo, "docs/design/src/002-running.md"), "utf8")
  expect(rule).toContain("The handler is always a function literal, and its syntax alone decides its kind")
  const handlers = ['() => "Hello, guest!"', '(() => "Hello, guest!")', 'effect () => "Hello, guest!"', 'function () { return "Hello, guest!" }']
  const temp = mkdtempSync(join(tmpdir(), "specification-example-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"name":"specification-demo","private":true,"type":"module"}')
    writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist" }, files: ["main.vibe"] }))
    await fc.assert(fc.asyncProperty(fc.constantFrom("Ada", "Grace", "Zoë", "李"), fc.integer({ min: 1, max: 9999 }), fc.constantFrom(...handlers), async (name, parcel, handler) => {
      for (const example of examples) {
        const source = readFileSync(resolve(repo, "site/videos/specification", example.name + ".vibe"), "utf8")
          .replaceAll("Ada", name).replaceAll("parcel-7", "parcel-" + parcel)
          .replace('catch () => "Hello, guest!"', "catch " + handler)
        writeFileSync(join(temp, "main.vibe"), source)
        const compile = await stage([defaultCompiler(), "-p", "tsconfig.json"], { cwd: temp })
        expect(compile.failure).toBe("")
        const run = await stage(["node", "dist/main.js"], { cwd: temp })
        expect(run.failure).toBe("")
        expect(run.stdout.trim()).toBe(example.output.replaceAll("Ada", name).replaceAll("parcel-7", "parcel-" + parcel))
      }
    }), { numRuns: 8, examples: handlers.map((handler, i) => ["Ada", i + 1, handler]) })
    const current = readFileSync(resolve(repo, "site/videos/specification/effects.vibe"), "utf8")
    writeFileSync(join(temp, "main.vibe"), current.replace('catch () => "Hello, guest!"', 'catch "Hello, guest!"'))
    const retired = await stage([defaultCompiler(), "-p", "tsconfig.json", "--noEmit"], { cwd: temp })
    expect(retired.exitCode).not.toBe(0)
    expect(retired.stdout + retired.stderr).toContain("EK0509")
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 60_000)
