import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const stock = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "typescript/bin/tsc")
const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
const skip = !existsSync(binary) || !existsSync(stock)
const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], noEmit: true, allowArbitraryExtensions: true }
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

test("directory-root sidecars quote the declaration contract", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/001-functions.md"), "utf8").includes(quote))
})

test("property: dot and parent module roots preserve native nominal identity in both sidecar layouts", { skip, timeout: 600000 }, async () => {
  await checkProperty(fc, {
    name: "sidecar-directory-module-roots",
    rule: "VIP-27 content and detail268: stock consumers read the source module through either sidecar layout",
    command: "node --test test/sidecar-directory-roots.property.test.mjs",
    numRuns: 12,
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      segments: fc.array(fc.constantFrom("nested", "odd name", "Ω"), { maxLength: 2 }),
      specifier: fc.constantFrom(".", "./", "..", "../"),
      style: fc.constantFrom(".js", ".ts", "extensionless")
    }),
    check: async ({ segments, specifier, style }) => {
      const root = mkdtempSync(join(tmpdir(), "vibelang-sidecar-module-roots-"))
      const producer = join(root, "project")
      const consumer = join(root, "consumer")
      const directory = posix.join("src", ...segments)
      const main = posix.join(directory, ...(specifier.startsWith("..") ? ["child"] : []), "main")
      const pkg = { name: "sidecar-root-fixture", version: "0.0.0", type: "module", types: "./" + main + ".ts" }
      try {
        write(join(producer, directory, "index.ts"), 'export class Marker { private brand!: void; readonly tag = "native" as const }\n')
        write(join(producer, main + ".ts"), "export { Marker } from " + JSON.stringify(specifier) + "\n")
        write(join(producer, "package.json"), JSON.stringify(pkg))
        write(join(consumer, "package.json"), '{"type":"module"}')
        write(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: options, include: ["entry.ts"] }))
        write(join(consumer, "entry.ts"),
          'import type { Marker } from "sidecar-root-fixture"\n' +
          "import type { Marker as NativeMarker } from " + JSON.stringify("../project/" + directory + "/index.js") + "\n" +
          "declare const imported: Marker\nconst original: NativeMarker = imported\n" +
          "declare const native: NativeMarker\nconst reverse: Marker = native\n")
        mkdirSync(join(consumer, "node_modules"), { recursive: true })
        symlinkSync(producer, join(consumer, "node_modules/sidecar-root-fixture"), "dir")
        // The identical native TypeScript graph establishes the directory-import and identity counterpart.
        run(process.execPath, [stock, "-p", "tsconfig.json", "--pretty", "false"], consumer)
        renameSync(join(producer, main + ".ts"), join(producer, main + ".vibe"))
        for (const relocated of [false, true, false]) {
          const sidecar = posix.join(relocated ? ".vibe/declarations" : "", main + ".d.vibe.ts")
          write(join(producer, "tsconfig.json"), JSON.stringify({
            compilerOptions: { ...options, ...(relocated ? { rootDirs: [".", ".vibe/declarations"] } : {}) },
            vibe: { effectGlobals: false, effectModules: false, ...(relocated ? { sidecarDir: ".vibe/declarations" } : {}) },
            vibelang: { declarationImportStyle: style },
            include: ["src"]
          }))
          run(binary, ["-p", "tsconfig.json", "--pretty", "false"], producer)
          assert.ok(existsSync(join(producer, sidecar)), sidecar)
          write(join(producer, "package.json"), JSON.stringify({ ...pkg, types: "./" + sidecar }))
          // The consumer has no producer rootDirs. Both private brands must still be the native class.
          run(process.execPath, [stock, "-p", "tsconfig.json", "--pretty", "false"], consumer)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})
