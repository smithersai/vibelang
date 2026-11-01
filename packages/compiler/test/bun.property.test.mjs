import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const preload = process.env.VIBELANG_TEST_PRELOAD || fileURLToPath(new URL("../bun.mjs", import.meta.url))
const hasBun = spawnSync("bun", ["--version"]).status === 0
// Chapter 7: "Existing tools work." Loading a TypeScript-only graph must keep
// Bun's results. opencode-18 adds a work bound: dependency graph size must not
// cause the preload to scan dependency sources when no .vibe module loads.
// Count parser work instead of asserting elapsed time on a shared build host.
const rule = "docs/design/src/007-tooling.md: Existing tools work; opencode-18: dependency discovery is bounded"
const regressions = new URL("./property-regressions/", import.meta.url)
const graph = fc.record({
  depth: fc.integer({ min: 1, max: 8 }),
  width: fc.integer({ min: 1, max: 5 }),
  format: fc.constantFrom("esm", "cjs"),
  extension: fc.constantFrom("js", "ts"),
  nested: fc.boolean(),
  dynamic: fc.boolean(),
  value: fc.integer({ min: -20, max: 20 })
})
let diagnostics = ""

function filesOf(input) {
  const { depth, width, format, extension, nested, dynamic, value } = input
  const base = "node_modules/dep/"
  const inner = nested ? base + "node_modules/inner/" : base
  const files = {
    "package.json": '{"type":"module"}\n',
    // A migrated module can be present without being reached by this test.
    "unused.vibe": "export const migrated = 42\n",
    [base + "package.json"]: JSON.stringify({ name: "dep", type: format === "esm" ? "module" : "commonjs", main: "index." + extension }) + "\n"
  }
  for (let level = depth - 1; level >= 0; level--) {
    for (let branch = 0; branch < width; branch++) {
      const path = inner + "part" + level + "-" + branch + "." + extension
      const next = "./part" + (level + 1) + "-" + branch + "." + extension
      files[path] = "// opencode-dependency-source\n" + (format === "esm"
        ? level === depth - 1 ? "export const value = " + value + "\n" : "export { value } from " + JSON.stringify(next) + "\n"
        : level === depth - 1 ? "module.exports = { value: " + value + " }\n" : "module.exports = require(" + JSON.stringify(next) + ")\n")
    }
  }
  const imports = Array.from({ length: width }, (_, branch) => "./part0-" + branch + "." + extension)
  const entry = "// opencode-dependency-source\n" + (format === "esm"
    ? imports.map((path, i) => "import { value as v" + i + " } from " + JSON.stringify(path)).join("\n") + "\nexport const value = " + imports.map((_, i) => "v" + i).join(" + ") + "\n"
    : "module.exports = { value: " + imports.map(path => "require(" + JSON.stringify(path) + ").value").join(" + ") + " }\n")
  if (nested) {
    files[inner + "package.json"] = JSON.stringify({ name: "inner", type: format === "esm" ? "module" : "commonjs", main: "index." + extension }) + "\n"
    files[inner + "index." + extension] = entry
    files[base + "index." + extension] = "// opencode-dependency-source\n" + (format === "esm"
      ? 'export { value } from "inner"\n' : 'module.exports = require("inner")\n')
  } else files[base + "index." + extension] = entry
  files["main.ts"] = (dynamic ? 'const dep = await import("dep")' : 'import * as dep from "dep"') + '\nconsole.log(dep.value)\n'
  files["scan.mjs"] = [
    "const Original = Bun.Transpiler",
    "let scanned = 0",
    "Bun.Transpiler = function(options) {",
    "  const transpiler = new Original(options)",
    "  const scan = transpiler.scanImports.bind(transpiler)",
    "  transpiler.scanImports = (code, ...rest) => {",
    '    if (code.includes("opencode-dependency-source")) scanned++',
    "    return scan(code, ...rest)",
    "  }",
    "  return transpiler",
    "}",
    "await import(process.env.VIBELANG_TEST_PRELOAD)",
    'process.on("exit", () => console.error("dependency scans: " + scanned))',
    ""
  ].join("\n")
  return files
}

function check(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-property-")))
  try {
    for (const [file, contents] of Object.entries(filesOf(input))) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    const run = (args) => spawnSync("bun", args, {
      cwd: root, encoding: "utf8", timeout: 20000, maxBuffer: 1 << 20,
      env: { ...process.env, VIBELANG_TEST_PRELOAD: preload, NO_COLOR: "1" }
    })
    const native = run(["main.ts"])
    const loaded = run(["--preload", "./scan.mjs", "main.ts"])
    diagnostics = JSON.stringify({ input, native, loaded }).replaceAll(root, "<project>")
    for (const result of [native, loaded]) {
      assert.ifError(result.error)
      assert.equal(result.status, 0, diagnostics)
    }
    assert.equal(native.stdout, String(input.width * input.value) + "\n", diagnostics)
    assert.equal(loaded.stdout, native.stdout, diagnostics)
    assert.match(loaded.stderr, /dependency scans: 0\n/, diagnostics)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Bun preload preserves generated dependency graphs without scanning them (opencode-18)", {
  skip: !hasBun && "bun is not on PATH"
}, async t => {
  await checkProperty(fc, {
    name: "bun-dependency-discovery", rule,
    command: "node --test test/bun.property.test.mjs",
    arbitrary: graph, numRuns: 50, regressions, artifacts: filesOf,
    diagnostics: () => diagnostics, check
  })
  t.diagnostic("ESM/CommonJS, JS/TS, nested packages, static/dynamic imports, depth and fan-out; no timing oracle")
})

// alchemy-30: under the preload, createRequire(base) resolves from base, as
// Node documents it ("filename to be used to construct the require
// function"), on every Bun: Bun 1.3.13 calls a replaced CommonJS hook
// without the parent for such a require, so the preload must leave the hook
// alone there. VIBELANG_TEST_BUN names another Bun to check, such as the
// 1.3.13 alchemy pins. The layout varies where the importer sits, where Bun
// runs, what createRequire receives, and what is resolved.
const testBun = process.env.VIBELANG_TEST_BUN || "bun"
const hasTestBun = spawnSync(testBun, ["--version"]).status === 0
const originRule = "Node's createRequire(filename): resolution is relative to filename; alchemy-30: Bun 1.3.13 loses it under a CommonJS hook"
const originLayout = fc.record({
  depth: fc.integer({ min: 0, max: 3 }),
  cwd: fc.constantFrom("root", "sibling", "importer"),
  base: fc.constantFrom("import.meta.url", "url-string", "path", "other-file"),
  request: fc.constantFrom("probe/node", "probe", "./local.cjs", "../up.cjs"),
  call: fc.constantFrom("resolve", "require")
})
let originDiagnostics = ""

// The importer's directory, and the directory createRequire's base names.
function originDirs({ depth, base }) {
  const importer = ["app", ...Array.from({ length: depth }, (_, i) => "d" + i)].join("/")
  return { importer, from: base === "other-file" ? importer + "/other" : importer }
}

// Each file a request can reach holds its own path, which require prints.
function originFiles(input) {
  const { importer, from } = originDirs(input)
  const up = dirname(from) === "." ? "up.cjs" : dirname(from) + "/up.cjs"
  const files = {
    "package.json": '{"type":"module"}\n',
    "sibling/README.md": "Bun runs here, beside the importer's tree.\n",
    "app/node_modules/probe/package.json": JSON.stringify({ name: "probe", main: "main.cjs", exports: { ".": "./main.cjs", "./node": "./node.cjs" } }) + "\n"
  }
  for (const file of ["app/node_modules/probe/main.cjs", "app/node_modules/probe/node.cjs", from + "/local.cjs", up]) {
    files[file] = "module.exports = " + JSON.stringify(file) + "\n"
  }
  const base = {
    "import.meta.url": "import.meta.url",
    "url-string": "import.meta.url.toString()",
    path: "fileURLToPath(import.meta.url)",
    "other-file": 'new URL("./other/entry.mjs", import.meta.url)'
  }[input.base]
  const request = JSON.stringify(input.request)
  files[importer + "/entry.mjs"] = [
    'import { createRequire } from "node:module"',
    'import { fileURLToPath } from "node:url"',
    "const require = createRequire(" + base + ")",
    "console.log(" + (input.call === "resolve" ? "require.resolve(" + request + ")" : "require(" + request + ")") + ")",
    ""
  ].join("\n")
  return files
}

// What Node resolves: the file the layout puts there, from the base's directory.
function originExpected(root, input) {
  const { from } = originDirs(input)
  const file = {
    "probe/node": "app/node_modules/probe/node.cjs",
    probe: "app/node_modules/probe/main.cjs",
    "./local.cjs": from + "/local.cjs",
    "../up.cjs": dirname(from) === "." ? "up.cjs" : dirname(from) + "/up.cjs"
  }[input.request]
  return input.call === "resolve" ? join(root, file) : file
}

function checkOrigin(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-origin-")))
  try {
    for (const [file, contents] of Object.entries(originFiles(input))) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    const importer = join(root, originDirs(input).importer)
    const cwd = input.cwd === "root" ? root : input.cwd === "sibling" ? join(root, "sibling") : importer
    const result = spawnSync(testBun, ["--preload", preload, join(importer, "entry.mjs")], { cwd, encoding: "utf8", timeout: 20000, env: { ...process.env, NO_COLOR: "1" } })
    originDiagnostics = JSON.stringify({ input, status: result.status, stdout: result.stdout, stderr: result.stderr }).replaceAll(root, "<project>")
    assert.ifError(result.error)
    assert.equal(result.status, 0, originDiagnostics)
    assert.equal(result.stdout, originExpected(root, input) + "\n", originDiagnostics)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("createRequire(base) resolves from base under the preload (alchemy-30)", {
  skip: !hasTestBun && `${testBun} is not a Bun`
}, async t => {
  await checkProperty(fc, {
    name: "bun-create-require-origin", rule: originRule,
    command: "node --test test/bun.property.test.mjs",
    arbitrary: originLayout, numRuns: 24, regressions, artifacts: originFiles,
    diagnostics: () => originDiagnostics, check: checkOrigin
  })
  t.diagnostic(`${testBun}: importer depth, working directory, URL/string/path/other-file bases, subpath exports, main, relative and parent requests; resolve and require`)
})

// tests-opencode: the preload's CommonJS hook asks vibeImport for every
// require, and vibeImport reads the nearest tsconfig's paths through its
// extends chain, resolving a package-named config ("@tsconfig/bun/...")
// with require.resolve, which calls the hook again before the first read is
// cached. Each nested call read the same config again until the stack ran
// out: one require("fs") in opencode's packages/core made 2,459 hook calls
// (210 ms; 22 s across a TUI plugin's graph). A resolution the preload starts
// itself is never a .vibe import, so hook calls per require stay bounded by
// the configs' extends references, and every answer stays the same.
const extendsRule = "docs/design/src/007-tooling.md: Existing tools work; a require costs one lookup per tsconfig extends reference, not a re-entrant walk"
const extendsLayout = fc.record({
  links: fc.array(fc.constantFrom("package", "relative", "array"), { minLength: 1, maxLength: 3 }),
  paths: fc.constantFrom("none", "own", "inherited"),
  request: fc.constantFrom("fs", "node:fs", "probe", "@/x", "./local.cjs"),
  call: fc.constantFrom("resolve", "require")
})
let extendsDiagnostics = ""

// Link i is one more config: a package's tsconfig.json in node_modules, a
// relative file, or both named by an extends array. Each extends link i + 1;
// the last link sets paths when paths is "inherited", the project's own
// tsconfig when "own".
function extendsFiles(input) {
  const files = {
    "package.json": '{"type":"module"}\n',
    "node_modules/probe/package.json": '{"name":"probe","main":"main.cjs"}\n',
    "node_modules/probe/main.cjs": 'module.exports = "probe"\n',
    "src/x.vibe": "export const x = 1\n",
    "local.cjs": 'module.exports = "local"\n'
  }
  const { links } = input
  const packageFile = (i) => "node_modules/base" + i + "/tsconfig.json"
  const relativeFile = (i) => "configs/base" + i + ".json"
  const filesOfLink = (i) => links[i] === "package" ? [packageFile(i)] : links[i] === "relative" ? [relativeFile(i)] : [packageFile(i), relativeFile(i)]
  // How a config at `from` names link i.
  const reference = (from, i) => {
    const relativeName = posix.relative(posix.dirname(from), relativeFile(i))
    const names = { package: ["base" + i + "/tsconfig.json"], relative: [relativeName.startsWith(".") ? relativeName : "./" + relativeName] }
    const all = links[i] === "array" ? [...names.package, ...names.relative] : names[links[i]]
    return all.length === 1 ? all[0] : all
  }
  const config = (from, i, own) => JSON.stringify({
    ...(i < links.length ? { extends: reference(from, i) } : {}),
    compilerOptions: { strict: true, ...(own ? { paths: { "@/*": ["./src/*"] } } : {}) }
  }) + "\n"
  links.forEach((_, i) => {
    files["node_modules/base" + i + "/package.json"] = JSON.stringify({ name: "base" + i }) + "\n"
    for (const file of filesOfLink(i)) files[file] = config(file, i + 1, i === links.length - 1 && input.paths === "inherited")
  })
  files["tsconfig.json"] = config("tsconfig.json", 0, input.paths === "own")
  const request = JSON.stringify(input.request)
  files["main.cjs"] = (input.call === "resolve"
    ? "console.log(require.resolve(" + request + "))"
    : "const value = require(" + request + "); console.log(typeof value === \"string\" ? value : typeof value)") + "\n"
  files["count.mjs"] = [
    "await import(process.env.VIBELANG_TEST_PRELOAD)",
    'const Module = (await import("node:module")).default',
    "const hook = Module._resolveFilename",
    "let calls = 0",
    "Module._resolveFilename = function (...args) { calls++; return hook.apply(this, args) }",
    'process.on("exit", () => console.error("hook calls: " + calls))',
    ""
  ].join("\n")
  return files
}

// Config references the hook may resolve: one per package name in a chain
// link, each tried as name, name.json and name/tsconfig.json.
const extendsBound = (input) => 1 + 3 * input.links.filter((kind) => kind !== "relative").length

function checkExtends(input) {
  // Loading x.vibe needs the compiler, and an inherited alias's base is the
  // config that wrote it; resolving against the project's own paths covers the alias.
  if (input.request === "@/x" && (input.call === "require" || input.paths !== "own")) return
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-extends-")))
  try {
    for (const [file, contents] of Object.entries(extendsFiles(input))) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    const run = (args) => spawnSync("bun", args, {
      cwd: root, encoding: "utf8", timeout: 20000, maxBuffer: 1 << 20,
      env: { ...process.env, VIBELANG_TEST_PRELOAD: preload, NO_COLOR: "1" }
    })
    const loaded = run(["--preload", "./count.mjs", "main.cjs"])
    extendsDiagnostics = JSON.stringify({ input, status: loaded.status, stdout: loaded.stdout, stderr: loaded.stderr.slice(-4000) }).replaceAll(root, "<project>")
    assert.ifError(loaded.error)
    assert.equal(loaded.status, 0, extendsDiagnostics)
    const expected = {
      fs: input.call === "resolve" ? "fs" : "object",
      "node:fs": input.call === "resolve" ? "node:fs" : "object",
      probe: input.call === "resolve" ? join(root, "node_modules/probe/main.cjs") : "probe",
      "./local.cjs": input.call === "resolve" ? join(root, "local.cjs") : "local",
      "@/x": join(root, "src/x.vibe")
    }[input.request]
    assert.equal(loaded.stdout, expected + "\n", extendsDiagnostics)
    const calls = Number(/hook calls: (\d+)/.exec(loaded.stderr)?.[1])
    assert.ok(calls <= extendsBound(input), `hook calls ${calls} > ${extendsBound(input)}: ` + extendsDiagnostics)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a require under the preload reads each tsconfig of the extends chain once (tests-opencode)", {
  skip: !hasBun && "bun is not on PATH"
}, async t => {
  await checkProperty(fc, {
    name: "bun-tsconfig-extends-reentry", rule: extendsRule,
    command: "node --test test/bun.property.test.mjs",
    arbitrary: extendsLayout, numRuns: 40, regressions, artifacts: extendsFiles,
    diagnostics: () => extendsDiagnostics, check: checkExtends
  })
  t.diagnostic("package, relative and array extends chains of 1-3 links; paths own, inherited or none; builtin, node:, bare, relative and alias requests; resolve and require; counts hook calls, no timing oracle")
})
