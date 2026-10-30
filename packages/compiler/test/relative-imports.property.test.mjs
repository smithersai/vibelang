import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { extensionlessImport } from "../relative-imports.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const rule = "packages/compiler/relative-imports.mjs: extensionlessImport's Node10 and Bundler resolution contract"
const regressions = new URL("./property-regressions/", import.meta.url)
const extensions = ["ts", "tsx", "vibe", "d.ts", "js", "jsx"]
const stems = ["app/x", "app/x/index", "app/sub/x", "app/sub/x/index", "app/index", "index", "app"]
const namedSpecifiers = ["./x", "./x/index", "./sub/x"].flatMap(stem =>
  [...extensions, "mts", "cts", "mjs", "cjs", "d.mts", "d.cts", "json"].map(extension => `${stem}.${extension}`))
const tree = fc.record({
  files: fc.subarray(stems.flatMap(stem => extensions.map(extension => `${stem}.${extension}`)), { maxLength: 12 }),
  directories: fc.subarray(["app/x", "app/sub/x"]),
  packages: fc.subarray(["app/x", "app/sub/x"]),
  specifier: fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom("./x", "./x/", "./x/index", "./sub/x", ".", "./", "..") },
    { weight: 1, arbitrary: fc.constantFrom(...namedSpecifiers) })
})
const modes = ["bundler", "node10"]
const cache = new Map()
let compilerRuns = 0
let diagnostics = ""

function config(moduleResolution) {
  return JSON.stringify({ compilerOptions: {
    module: "ESNext", moduleResolution, noLib: true, types: [], allowJs: true,
    allowImportingTsExtensions: true, ignoreDeprecations: "6.0"
  }, files: ["app/main.vibe"] }) + "\n"
}

function filesOf(input) {
  return {
    ...Object.fromEntries(input.files.map(file => [file,
      file.endsWith(".d.ts") ? "export declare const value: number\n" : "export const value = 1\n"])),
    ...Object.fromEntries(input.packages.map(directory => [`${directory}/package.json`,
      JSON.stringify({ types: "./index.d.ts", main: "./index.js" }) + "\n"])),
    "app/main.vibe": `import { value } from ${JSON.stringify(input.specifier)}\nexport { value }\n`,
    ...Object.fromEntries(modes.map(mode => [`tsconfig.${mode}.json`, config(mode)]))
  }
}

function resolutions(input) {
  const files = filesOf(input)
  const directories = [...new Set(["app/sub", ...input.directories, ...Object.keys(files).map(dirname)])].sort()
  // Include empty directories, but do not rerun for an explicitly requested directory a file already creates.
  const key = JSON.stringify({ files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)), directories })
  if (cache.has(key)) return cache.get(key)
  assert.ok(existsSync(compiler), `property setup: missing ${compiler}; build the compiler first`)
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-relative-imports-")))
  try {
    for (const directory of directories) mkdirSync(join(root, directory), { recursive: true })
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    const actual = extensionlessImport(join(root, "app"), input.specifier)
    const results = modes.map(mode => {
      compilerRuns++
      const run = spawnSync(compiler, ["-p", `tsconfig.${mode}.json`, "--traceResolution", "--noEmit"], {
        cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 1 << 20,
        env: { ...process.env, NO_COLOR: "1" }
      })
      diagnostics = `${mode}: status=${run.status} signal=${run.signal}\n${run.stdout}\n${run.stderr}`.replaceAll(root, "<tree>")
      assert.ifError(run.error)
      // Missing libraries/Effect and unresolved imports may diagnose; resolution still has to finish.
      assert.ok([0, 1, 2].includes(run.status), diagnostics)
      const start = `======== Resolving module '${input.specifier}' from '${join(root, "app/main.vibe")}'. ========`
      const lines = run.stdout.split(/\r?\n/)
      const first = lines.indexOf(start)
      assert.ok(first >= 0, `missing import trace\n${diagnostics}`)
      const last = lines.findIndex((line, i) => i > first && line.startsWith(`======== Module name '${input.specifier}' `))
      assert.ok(last > first, `incomplete import trace\n${diagnostics}`)
      const trace = lines.slice(first, last + 1).join("\n")
      const selected = trace.includes(`Explicitly specified module resolution kind: '${mode === "bundler" ? "Bundler" : "Node10"}'.`)
      // TS5108: current compiler versions remove Node10 and silently resolve using Bundler instead.
      // Exclude that unsupported mode from the property; compare it automatically if Node10 returns.
      const unsupported = !selected && mode === "node10" &&
        run.stdout.includes("error TS5108: Option 'moduleResolution=node10' has been removed.") &&
        trace.includes("Module resolution kind is not specified, using 'Bundler'.")
      assert.ok(selected || unsupported, `compiler did not use ${mode}\n${diagnostics}`)
      const found = /was successfully resolved to '([^']+)'/.exec(lines[last])?.[1]
      assert.ok(found !== undefined || lines[last].includes("was not resolved"), diagnostics)
      return { mode, unsupported, actual: actual === undefined ? undefined : relative(root, actual),
        resolved: found === undefined ? undefined : relative(root, found),
        packageRead: trace.includes("Found 'package.json' at '"), trace: trace.replaceAll(root, "<tree>") }
    })
    cache.set(key, results)
    return results
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("relative-imports: extensionless resolution agrees with the compiler", async t => {
  await checkProperty(fc, {
    name: "relative-imports", rule, command: "node --test test/relative-imports.property.test.mjs",
    arbitrary: tree, numRuns: 80, regressions, artifacts: filesOf, diagnostics: () => diagnostics,
    check: input => {
      for (const result of resolutions(input)) {
        diagnostics = `${JSON.stringify(input)}\n${result.trace}`
        const context = `${result.mode}: ${JSON.stringify(input)}`
        if (result.unsupported) continue
        if (namedSpecifiers.includes(input.specifier) || result.packageRead) {
          // Explicit extensions and package entry points belong to the host loader.
          assert.equal(result.actual, undefined, context)
        } else {
          if (result.resolved !== undefined) assert.ok(input.files.includes(result.resolved), context)
          assert.equal(result.actual, result.resolved, context)
        }
      }
    }
  })
  t.diagnostic(`${cache.size} distinct trees/specifiers; ${compilerRuns} compiler runs across both modes`)
  if ([...cache.values()].some(results => results.some(result => result.unsupported))) {
    t.diagnostic("Node10 comparisons excluded: TS5108 removes node10; its trace selects Bundler instead")
  }
})
