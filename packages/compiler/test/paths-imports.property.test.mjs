import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { aliasImport, forgetPaths } from "../paths-imports.mjs"

// The oracle is the compiler's own module resolution, read from
// --traceResolution: aliasImport must pick the file TypeScript picks for a
// paths alias, so the loaders find the .vibe module the program compiled.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const rule = "packages/compiler/paths-imports.mjs: aliasImport resolves a tsconfig paths alias as TypeScript does"
const regressions = new URL("./property-regressions/", import.meta.url)
const extensions = ["ts", "tsx", "vibe", "d.ts", "js"]
const stems = ["src/x", "src/x/index", "src/sub/x", "lib/x", "lib/x/index", "lib/sub/x"]
const patterns = {
  "@/*": [["./src/*"], ["./lib/*", "./src/*"]],
  "@/sub/*": [["./lib/sub/*"], ["./src/sub/*"]],
  "~x": [["./src/x"], ["./lib/x/index"], ["./lib/x", "./src/x"]]
}
const tree = fc.record({
  files: fc.subarray(stems.flatMap(stem => extensions.map(extension => `${stem}.${extension}`)), { minLength: 1, maxLength: 10 }),
  paths: fc.record(Object.fromEntries(Object.entries(patterns).map(([key, choices]) => [key, fc.constantFrom(undefined, ...choices)]))),
  // paths written in a base config one directory down, which its substitutions are relative to
  inherited: fc.boolean(),
  specifier: fc.constantFrom("@/x", "@/x.js", "@/x/index", "@/sub/x", "~x", "@/missing", "@/x.vibe")
})
let diagnostics = ""
let compilerRuns = 0

function pathsOf(input, prefix) {
  return Object.fromEntries(Object.entries(input.paths).filter(([, substitutions]) => substitutions !== undefined)
    .map(([key, substitutions]) => [key, substitutions.map(substitution => substitution.replace("./", prefix))]))
}

function filesOf(input) {
  const compilerOptions = {
    module: "ESNext", moduleResolution: "Bundler", noLib: true, types: [], allowJs: true, allowImportingTsExtensions: true
  }
  const files = {
    ...Object.fromEntries(input.files.map(file => [file,
      file.endsWith(".d.ts") ? "export declare const value: number\n" : "export const value = 1\n"])),
    "src/main.vibe": `import { value } from ${JSON.stringify(input.specifier)}\nexport { value }\n`
  }
  if (input.inherited) {
    files["config/base.json"] = `{\n  // paths relative to this directory\n  "compilerOptions": { "paths": ${JSON.stringify(pathsOf(input, "../"))}, },\n}\n`
    files["tsconfig.json"] = JSON.stringify({ extends: "./config/base", compilerOptions, files: ["src/main.vibe"] }) + "\n"
  } else {
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { ...compilerOptions, paths: pathsOf(input, "./") }, files: ["src/main.vibe"] }) + "\n"
  }
  return files
}

function resolution(input) {
  assert.ok(existsSync(compiler), `property setup: missing ${compiler}; build the compiler first`)
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-paths-imports-")))
  try {
    for (const [file, contents] of Object.entries(filesOf(input))) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    forgetPaths()
    const actual = aliasImport(join(root, "tsconfig.json"), input.specifier)
    compilerRuns++
    const run = spawnSync(compiler, ["-p", "tsconfig.json", "--traceResolution", "--noEmit"], {
      cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 1 << 20, env: { ...process.env, NO_COLOR: "1" }
    })
    diagnostics = `status=${run.status} signal=${run.signal}\n${run.stdout}\n${run.stderr}`.replaceAll(root, "<tree>")
    assert.ifError(run.error)
    assert.ok([0, 1, 2].includes(run.status), diagnostics)
    const lines = run.stdout.split(/\r?\n/)
    const start = lines.indexOf(`======== Resolving module '${input.specifier}' from '${join(root, "src/main.vibe")}'. ========`)
    assert.ok(start >= 0, `missing import trace\n${diagnostics}`)
    const last = lines.findIndex((line, i) => i > start && line.startsWith(`======== Module name '${input.specifier}' `))
    assert.ok(last > start, `incomplete import trace\n${diagnostics}`)
    const found = /was successfully resolved to '([^']+)'/.exec(lines[last])?.[1]
    assert.ok(found !== undefined || lines[last].includes("was not resolved"), diagnostics)
    return {
      actual: actual === undefined ? undefined : relative(root, actual),
      resolved: found === undefined ? undefined : relative(root, found)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("paths-imports: a paths alias resolves to the file the compiler resolves it to", async t => {
  await checkProperty(fc, {
    name: "paths-imports", rule, command: "node --test test/paths-imports.property.test.mjs",
    arbitrary: tree, numRuns: 60, regressions, artifacts: filesOf, diagnostics: () => diagnostics,
    check: input => {
      const { actual, resolved } = resolution(input)
      const vibe = (file) => file?.endsWith(".vibe") ? file : undefined
      // The loaders act only on a .vibe result: it is the compiler's exactly.
      assert.equal(vibe(actual), vibe(resolved), JSON.stringify(input))
      // An extensionless alias resolves as the compiler resolves it, whatever the file.
      if (!/\.[a-z]+$/.test(input.specifier)) assert.equal(actual, resolved, JSON.stringify(input))
    }
  })
  t.diagnostic(`${compilerRuns} compiler runs`)
})
