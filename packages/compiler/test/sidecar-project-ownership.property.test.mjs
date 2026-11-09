import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const quote = "Compiler cleanup removes only unchanged alternate-layout declarations it previously generated for the compiling project, preserving another project's declarations, outputs still shared with another project, and declarations without ownership records."

test("sidecar ownership oracle quotes the tooling specification", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(quote))
})

test("nested project sidecars survive every check order and shared-layout switch", { timeout: 600000 }, async () => {
  assert.ok(existsSync(binary), "build the native compiler before running this property")
  await checkProperty(fc, {
    name: "sidecar-project-ownership",
    rule: quote,
    command: "node --test test/sidecar-project-ownership.property.test.mjs",
    numRuns: 24,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      depth: fc.integer({ min: 1, max: 3 }),
      name: fc.constantFrom("W", "Worker", "Ω", "a.b"),
      extension: fc.constantFrom(".vibe", ".vibex"),
      workerFirst: fc.boolean(),
      shared: fc.boolean()
    }),
    check: async ({ depth, name, extension, workerFirst, shared }) => {
      const root = mkdtempSync(join(tmpdir(), "sidecar-project-ownership-"))
      const put = (path, value) => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value))
      }
      const run = (config) => {
        const result = spawnSync(binary, ["-p", config, "--noEmit", "--singleThreaded", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
      }
      const check = (path) => {
        assert.ok(existsSync(join(root, path)), path)
        assert.match(readFileSync(join(root, path), "utf8"), /export declare const W = 1;/)
      }
      try {
        const nested = Array(depth).fill("worker").join("/")
        const source = posix.join(nested, name + extension)
        const adjacent = posix.join(nested, name + ".d" + extension + ".ts")
        const hidden = posix.join(".vibe/declarations", adjacent)
        const options = { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", types: [], noEmit: true, rewriteRelativeImportExtensions: true }
        const config = (files, layout) => ({
          compilerOptions: { ...options, rootDir: "." },
          vibe: { effectGlobals: false, effectModules: false, ...(layout ? { sidecarDir: layout } : {}) },
          files
        })
        put(source, "export const W = 1\n")
        put("Root" + extension, 'export { W } from "./' + source + '"\n')
        put(nested + "/tsconfig.json", config([name + extension]))
        put("tsconfig.json", config(["Root" + extension], shared ? undefined : ".vibe/declarations"))
        const order = workerFirst ? [nested + "/tsconfig.json", "tsconfig.json"] : ["tsconfig.json", nested + "/tsconfig.json"]
        for (const project of order) run(project)
        check(adjacent)
        if (shared) {
          put("tsconfig.json", config(["Root" + extension], ".vibe/declarations"))
          run("tsconfig.json")
          check(adjacent)
        }
        check(hidden)
        // Repeated checks must not undo the other project's successful output.
        for (const project of order) {
          run(project)
          check(adjacent)
          check(hidden)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})

