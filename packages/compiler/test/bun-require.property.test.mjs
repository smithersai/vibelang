import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// A module that reaches a .vibe module loads as its .ts twin does without
// vibelang: by import, by require() and by createRequire's require(), whatever
// the specifier, the barrels between them and the strings that look like the
// specifier (opencode: bun:require-native-plugin-effect-async). Bun makes a
// module whose onLoad returns a pending Promise async, and require() of an
// async module throws, so the oracle is the twin under Bun alone.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const preload = join(compilerPackage, "bun.mjs")
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = !hasBun ? "bun is not on PATH" : missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`
const rule = "docs/design/src/007-tooling.md: Existing tools work; a module that loads as .ts under Bun loads the same way when what it imports is .vibe"
const regressions = new URL("./property-regressions/", import.meta.url)

const layout = fc.record({
  specifier: fc.constantFrom("extensionless", "js", "explicit", "alias", "directory"),
  quote: fc.constantFrom('"', "'"),
  form: fc.constantFrom("named", "star", "import-export", "namespace"),
  barrels: fc.integer({ min: 1, max: 3 }),
  entry: fc.constantFrom("require", "createRequire", "import"),
  preimport: fc.boolean(),
  decoy: fc.boolean(),
  typeImport: fc.boolean(),
  // The imported module imports a native helper, and a host plugin (as
  // OpenTUI's runtime plugin does) gives each project file it sees by an
  // absolute specifier an async onLoad.
  helper: fc.boolean(),
  host: fc.boolean(),
  value: fc.integer({ min: -20, max: 20 })
// Bun 1.4.2 names a dynamic import's target to onResolve by its absolute
// path, so with the host plugin a prior import makes the .ts twin itself
// async: that pair has no oracle there.
}).map((input) => input.host && input.preimport ? { ...input, preimport: false } : input)
let diagnostics = ""
const hostPlugin = [
  'const { isAbsolute } = require("node:path")',
  "const wrapped = new Set()",
  'Bun.plugin({ name: "host-rewrite", setup(build) {',
  "  build.onResolve({ filter: /.*/ }, (args) => {",
  "    const path = args.path",
  "    if (!isAbsolute(path) || /[\\\\/]node_modules[\\\\/]/.test(path) || !/\\.[cm]?[jt]sx?$/.test(path) || wrapped.has(path)) return undefined",
  "    wrapped.add(path)",
  '    const exact = new RegExp("^" + path.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "$")',
  '    build.onLoad({ filter: exact }, async (loaded) => ({ contents: await Bun.file(loaded.path).text(), loader: loaded.path.endsWith(".js") ? "js" : "ts" }))',
  "    return undefined",
  "  })",
  "} })",
  ""
].join("\n")

// The files of the layout, with the imported module as .vibe or as its .ts twin.
function filesOf(input, extension = "vibe") {
  const { specifier, quote, form, barrels, entry, preimport, decoy, typeImport, helper = false, host = false, value } = input
  const dep = specifier === "directory" ? "src/dep/index." + extension : "src/dep." + extension
  const name = {
    extensionless: "./dep", js: "./dep.js", explicit: "./dep." + extension, alias: "@/dep", directory: "./dep"
  }[specifier]
  const q = (text) => quote + text + quote
  const reexport = (from) => ({
    named: "export { value } from " + q(from),
    star: "export * from " + q(from),
    "import-export": "import { value as imported } from " + q(from) + "\nexport const value = imported",
    namespace: "import * as namespace from " + q(from) + "\nexport const value = namespace.value"
  }[form])
  const files = {
    "package.json": '{"type":"module"}\n',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, noEmit: true,
        allowImportingTsExtensions: true, paths: { "@/*": ["./src/*"] }
      },
      include: ["src/**/*"]
    }) + "\n",
    [dep]: helper
      ? 'import { base } from "./helper"\nexport type Value = number\nexport const value: number = base + ' + value + "\n"
      : "export type Value = number\nexport const value: number = " + value + "\n"
  }
  if (helper) files[dirname(dep) + "/helper.ts"] = "export const base: number = 0\n"
  if (host) files["host.cjs"] = hostPlugin
  const first = [reexport(name)]
  if (typeImport) first.unshift("import type { Value } from " + q(name), "export const typed: Value = 0")
  if (decoy) {
    // A string and a comment that spell the specifier are not imports.
    const label = q(name)
    first.push("const label = " + label + " // from " + label, "if (label.length !== " + name.length + ") throw new Error(\"rewrote a string\")")
  }
  files["src/barrel0.ts"] = first.join("\n") + "\n"
  for (let level = 1; level < barrels; level++) files["src/barrel" + level + ".ts"] = reexport("./barrel" + (level - 1)) + "\n"
  const top = "./barrel" + (barrels - 1) + ".ts"
  const loadHost = host ? (entry === "require" ? 'require("../host.cjs")\n' : 'import "../host.cjs"\n') : ""
  files[entry === "require" ? "src/main.cjs" : "src/main.ts"] = loadHost + {
    require: "console.log(require(" + JSON.stringify(top) + ").value)\n",
    createRequire: [
      'import { createRequire } from "node:module"',
      preimport ? "await import(" + JSON.stringify(top) + ")" : "",
      "console.log(createRequire(import.meta.url)(" + JSON.stringify(top) + ").value)",
      ""
    ].join("\n"),
    import: "import { value } from " + JSON.stringify(top) + "\nconsole.log(value)\n"
  }[entry]
  return files
}

function write(root, files) {
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), contents)
  }
}

function check(input) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-require-")))
  try {
    const vibe = join(base, "vibe")
    const twin = join(base, "twin")
    write(vibe, filesOf(input))
    write(twin, filesOf(input, "ts"))
    mkdirSync(join(vibe, "node_modules"))
    symlinkSync(realpathSync(effect), join(vibe, "node_modules/effect"))
    symlinkSync(runtime, join(vibe, "node_modules/vibelang-runtime"))
    symlinkSync(compilerPackage, join(vibe, "node_modules/vibelang"))
    const main = input.entry === "require" ? "src/main.cjs" : "src/main.ts"
    const run = (cwd, args) => spawnSync("bun", [...args, main], {
      cwd, encoding: "utf8", timeout: 30000, maxBuffer: 1 << 20,
      env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(cwd, ".cache"), NO_COLOR: "1" }
    })
    const expected = run(twin, [])
    const loaded = run(vibe, ["--preload", preload])
    diagnostics = JSON.stringify({ input, expected, loaded }).replaceAll(base, "<project>")
    for (const result of [expected, loaded]) {
      assert.ifError(result.error)
      assert.equal(result.status, 0, diagnostics)
    }
    assert.equal(expected.stdout, input.value + "\n", diagnostics)
    assert.equal(loaded.stdout, expected.stdout, diagnostics)
  } finally { rmSync(base, { recursive: true, force: true }) }
}

test("a module that reaches a .vibe module loads by import and require() as its .ts twin does (opencode)", { skip }, async (t) => {
  await checkProperty(fc, {
    name: "bun-require-vibe", rule,
    command: "node --test test/bun-require.property.test.mjs",
    arbitrary: layout, numRuns: 30, regressions, artifacts: (input) => filesOf(input),
    diagnostics: () => diagnostics, check
  })
  t.diagnostic("extensionless, .js, .vibe, paths alias and directory specifiers; named, star, import and namespace re-exports through 1-3 native barrels; require, createRequire and import, with and without a prior import; decoy strings and type-only imports; a native helper behind the .vibe module, with and without a host plugin that rewrites the project files it sees by absolute path by absolute path")
})
