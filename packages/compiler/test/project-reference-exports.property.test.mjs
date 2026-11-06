import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-project-reference-exports.json", import.meta.url), "utf8"))
const rule = "Ordinary declarations use the native twin's relative specifiers;"
assert.ok(readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(rule))
const options = { target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true,
  skipLibCheck: true, types: [], allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, declaration: true }

function files(input, stock) {
  const extension = stock ? input.extension.replace("vibex", "tsx").replace("vibe", "ts") : input.extension
  const leaf = input.nested ? "nested/data" : "data"
  return {
    "core/package.json": JSON.stringify({ name: "core", type: "module", exports: { "./Util": "./src/Util/index.ts" } }),
    "core/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, composite: true, rootDir: "src", outDir: input.outDir,
      disableSourceOfProjectReferenceRedirect: input.redirect, jsx: "preserve" }, include: ["src"], vibe: { effectGlobals: false, effectModules: false } }),
    ["core/src/Util/" + leaf + "." + extension]: corpus.source,
    "core/src/Util/index.ts": 'export * from "./' + leaf + "." + extension + '";\n',
    "app/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, noEmit: true,
      disableSourceOfProjectReferenceRedirect: input.redirect }, include: ["src"], references: [{ path: "../core" }],
      vibe: { effectGlobals: false, effectModules: false } }),
    ["app/src/main." + (input.nativeConsumer && !stock ? "vibe" : "ts")]: corpus.consumer,
  }
}

function check(input) {
  for (const stock of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "reference-native-exports-"))
    try {
      for (const [name, source] of Object.entries(files(input, stock))) {
        mkdirSync(dirname(join(root, name)), { recursive: true })
        writeFileSync(join(root, name), source)
      }
      mkdirSync(join(root, "app/node_modules"), { recursive: true })
      symlinkSync(join(root, "core"), join(root, "app/node_modules/core"), "dir")
      if (stock) {
        for (const name of ["core", "app"]) {
          const config = ts.readConfigFile(join(root, name, "tsconfig.json"), ts.sys.readFile)
          assert.equal(config.error, undefined)
          const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, join(root, name))
          assert.deepEqual(parsed.errors.map(d => d.code), [])
          const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences })
          const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
          assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "stock TypeScript twin " + name)
          if (name === "core") assert.equal(program.emit().emitSkipped, false)
        }
      } else {
        for (const name of ["core", "app"]) {
          const args = ["-p", name, "--pretty", "false", "--singleThreaded", ...(name === "core" ? ["--emitDeclarationOnly"] : ["--noEmit"])]
          const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 30000 })
          assert.ifError(result.error)
          assert.equal(result.status, 0, name + ": " + result.stdout + result.stderr)
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
}

test("alchemy project-reference barrel retains native exports after declaration emit", () => check(corpus.input))
test("built project references retain native exports across layouts and consumers", async () => {
  await checkProperty(fc, {
    name: "built-native-reference-exports", rule,
    command: "node --test packages/compiler/test/project-reference-exports.property.test.mjs",
    arbitrary: fc.record({ extension: fc.constantFrom("vibe", "vibex"), nested: fc.boolean(), nativeConsumer: fc.boolean(),
      redirect: fc.boolean(), outDir: fc.constantFrom("lib", "build/types", ".cache/types") }),
    numRuns: 16, check, artifacts: input => files(input, false),
  })
})

