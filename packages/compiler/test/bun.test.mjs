import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const preload = join(compilerPackage, "bun.mjs")
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = !hasBun ? "bun is not on PATH" : missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

const tsconfig = (include) => JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  },
  include
})

// A scratch project, with this package installed as vibelang, whose compiler
// records each invocation in calls.jsonl.
function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
  const calls = join(root, "calls.jsonl")
  const compiler = join(root, "compiler.mjs")
  writeFileSync(compiler, `import { appendFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n")
process.exit(spawnSync(${JSON.stringify(native)}, args, { stdio: "inherit" }).status ?? 1)
`)
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', "tsconfig.json": tsconfig(["src/**/*"]), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const bun = (args, env = {}) =>
    spawnSync("bun", args, {
      cwd: root, encoding: "utf8",
      env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), NO_COLOR: "1", ...env }
    })
  const compilations = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0
  return { root, bun, compilations }
}

const greeting = {
  "src/suffix.ts": "export const suffix = \"!\"\n",
  "src/shout.vibe": "export function shout(text: string): string { return text.toUpperCase() }\n",
  "src/where.vibe": "export function where(): string {\n  return new Error(\"here\").stack ?? \"\"\n}\n",
  "src/greet.vibe": [
    "import { shout } from \"./shout.vibe\"",
    "import { suffix } from \"./suffix.ts\"",
    "",
    "export function greet(name: string) {",
    "  return shout(`Hello, ${name}${suffix}`)",
    "}",
    ""
  ].join("\n")
}

test("bun runs .vibe modules imported from TypeScript, with one compile per project", { skip }, (t) => {
  const { bun, compilations } = project(t, {
    ...greeting,
    "main.ts": [
      "import { Effect } from \"effect\"",
      "import { greet } from \"./src/greet.vibe\"",
      "import { shout } from \"./src/shout.vibe\"",
      "import { where } from \"./src/where.vibe\"",
      "console.log(JSON.stringify({ text: Effect.runSync(greet(\"Ada\")), plain: shout(\"ok\"), named: /where\\.vibe:\\d+:\\d+/.test(where()) }))",
      ""
    ].join("\n")
  })
  const result = bun(["--preload", preload, "main.ts"])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { text: "HELLO, ADA!", plain: "OK", named: true }, "a frame names the .vibe module")
  assert.equal(compilations(), 1, "every .vibe module of a project comes from one compile")
})

test("bun runs a .vibe module's module declaration as a module of its own (D403)", { skip }, (t) => {
  const { bun, compilations } = project(t, {
    ...greeting,
    "src/text.vibe": [
      "module tools {",
      "  import { shout } from \"./shout.vibe\"",
      "  import { suffix } from \"./suffix.ts\"",
      "  import { String as Str } from \"effect\"",
      "  export let cleaned = 0",
      "  export function clean(value: string): string {",
      "    cleaned++",
      "    return Str.capitalize(shout(value.trim()).toLowerCase()) + suffix",
      "  }",
      "}",
      "import { clean } from tools",
      "export { cleaned } from tools",
      "export function tidy(value: string) {",
      "  return sync((value) => clean(value), value)",
      "}",
      ""
    ].join("\n"),
    "main.ts": [
      "import { Effect } from \"effect\"",
      "import { cleaned, tidy } from \"./src/text.vibe\"",
      "const text = Effect.runSync(tidy(\"  ab  \"))",
      "console.log(JSON.stringify({ text, cleaned }))",
      ""
    ].join("\n")
  })
  const result = bun(["--preload", preload, "main.ts"])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { text: "Ab!", cleaned: 1 }, "the module's export is a live binding")
  assert.equal(compilations(), 1, "the module comes from its file's compile")
})

test("bun test loads .vibe modules through a bunfig.toml preload of vibelang/bun", { skip }, async (t) => {
  const { bun, compilations } = project(t, {
    ...greeting,
    "bunfig.toml": "preload = [\"vibelang/bun\"]\n\n[test]\npreload = [\"vibelang/bun\"]\n",
    "greet.test.ts": [
      "import { expect, test } from \"bun:test\"",
      "import { Effect } from \"effect\"",
      "import { greet } from \"./src/greet.vibe\"",
      "test(\"greets\", () => {",
      "  expect(Effect.runSync(greet(\"Bun\"))).toBe(\"HELLO, BUN!\")",
      "})",
      ""
    ].join("\n"),
    "main.ts": "import { shout } from \"./src/shout.vibe\"\nconsole.log(shout(\"run\"))\n"
  })
  // A source as new as a compile is not cached, since it may have changed
  // while the compiler read it; wait past that.
  await sleep(120)
  const tested = bun(["test", "./greet.test.ts"])
  assert.equal(tested.status, 0, tested.stdout + tested.stderr)
  assert.match(tested.stdout + tested.stderr, /1 pass/)
  const ran = bun(["main.ts"])
  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ran.stdout, "RUN\n")
  assert.equal(compilations(), 1, "the second process loads the first one's compile from the cache")
})

test("bun reports the compiler's diagnostics when the project does not compile", { skip }, (t) => {
  const { bun } = project(t, {
    "src/bad.vibe": "export const count: number = \"three\"\n",
    "main.ts": "import { count } from \"./src/bad.vibe\"\nconsole.log(count)\n",
    "bad.test.ts": "import { expect, test } from \"bun:test\"\nimport { count } from \"./src/bad.vibe\"\ntest(\"count\", () => expect(count).toBe(3))\n"
  })
  for (const args of [["--preload", preload, "main.ts"], ["test", "--preload", preload, "./bad.test.ts"]]) {
    const result = bun(args)
    assert.notEqual(result.status, 0, args.join(" "))
    assert.match(result.stdout + result.stderr, /did not compile/)
    assert.match(result.stdout + result.stderr, /bad\.vibe:1:\d+ - error TS2322/)
  }
})

test("names VIBELANG_PROJECT when the nearest tsconfig does not include a module, and honors it", { skip }, (t) => {
  const { root, bun } = project(t, {
    "tsconfig.tools.json": tsconfig(["src/**/*", "tools/**/*"]),
    "src/index.ts": "export {}\n",
    "tools/answer.vibe": "export const answer: number = 42\n",
    "tools/run.ts": "import { answer } from \"./answer.vibe\"\nconsole.log(answer)\n"
  })
  const refused = bun(["--preload", preload, "tools/run.ts"])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /does not include .*answer\.vibe; set VIBELANG_PROJECT/)
  const accepted = bun(["--preload", preload, "tools/run.ts"], { VIBELANG_PROJECT: join(root, "tsconfig.tools.json") })
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(accepted.stdout, "42\n")
})

test("bun resolves a TypeScript module's .js import to the .vibe file that replaced its .ts file", { skip }, (t) => {
  const bundler = JSON.stringify({
    compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["main.ts", "src/**/*"]
  })
  const { bun } = project(t, {
    "tsconfig.json": bundler,
    "src/value.vibe": "export const value: number = 42\n",
    "src/other.ts": "export const other = 7\n",
    "main.ts": "import { value } from \"./src/value.js\"\nimport { other } from \"./src/other.js\"\nconsole.log(value + other)\n"
  })
  const result = bun(["--preload", preload, "main.ts"])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "49\n")
})

test("bun compiles a composite project, which may not turn off declaration emit or incremental compilation", { skip }, (t) => {
  const composite = JSON.stringify({
    compilerOptions: { composite: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true },
    include: ["main.ts", "src/**/*"]
  })
  const { bun } = project(t, {
    "tsconfig.json": composite,
    "src/value.vibe": "export function value(): number { return 1 }\n",
    "main.ts": "import { value } from \"./src/value.vibe\"\nconsole.log(value())\n"
  })
  const result = bun(["--preload", preload, "main.ts"])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "1\n")
})

test("under Node, vibelang/bun names vibelang/register", async () => {
  await assert.rejects(import(preload), /vibelang\/bun is a Bun preload; under Node, use node --import vibelang\/register/)
})

test("loads a clean module despite unrelated baseline errors, but rejects a loaded bad module", { skip }, (t) => {
  const { bun } = project(t, {
    "src/value.vibe": 'export const value = 42\n',
    "src/bad.vibe": 'export const value: number = "bad"\n',
    "src/unrelated.ts": 'export const baseline: number = "bad"\n',
    "main.ts": 'import { value } from "./src/value.vibe"; console.log(value)\n',
    "bad.ts": 'import { value } from "./src/bad.vibe"; console.log(value)\n'
  })
  const clean = bun(["--preload", preload, "main.ts"])
  assert.equal(clean.status, 0, clean.stderr)
  assert.equal(clean.stdout, "42\n")
  const bad = bun(["--preload", preload, "bad.ts"])
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /bad\.vibe:1:\d+ - error TS2322/)
  assert.doesNotMatch(bad.stderr, /unrelated\.ts/)
})

test("resolves an extensionless import to the .vibe file TypeScript resolves it to", { skip }, (t) => {
  const bundler = JSON.stringify({
    compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["script/**/*", "src/**/*"]
  })
  const { bun } = project(t, {
    "tsconfig.json": bundler,
    "src/archive.vibe": "export const archive: string = \"archive\"\n",
    // A stale emit beside its source: TypeScript resolves ../src/archive to archive.vibe first.
    "src/archive.js": "throw new Error(\"stale archive.js\")\n",
    "src/mount/index.vibe": "export const mounted: string = \"mounted\"\n",
    "src/nested.vibe": "import { archive } from \"./archive\"\nexport const nested: string = archive + \"!\"\n",
    "script/run.ts": [
      "import { archive } from \"../src/archive\"",
      "import { mounted } from \"../src/mount\"",
      "import { nested } from \"../src/nested\"",
      "console.log([archive, mounted, nested].join(\" \"))",
      ""
    ].join("\n")
  })
  const result = bun(["--preload", preload, "script/run.ts"])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "archive mounted archive!\n")
})


test("extensionless imports preserve TypeScript priority, dynamic imports and CommonJS dependencies", { skip }, (t) => {
  const { bun } = project(t, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, noEmit: true }, include: ["src/**/*"] }),
    "src/chosen.ts": 'export const chosen = "typescript"\n',
    "src/chosen.vibe": 'export const chosen = "wrong"\n',
    "src/value.vibe": 'export const value = "vibe"\n',
    "dep.cjs": 'module.exports = { cjs: "commonjs" }\n',
    "main.js": 'import dep from "./dep.cjs"; import { chosen } from "./src/chosen"; const { value } = await import("./src/value"); console.log(chosen, value, dep.cjs)\n'
  })
  const result = bun(["--preload", preload, "main.js"])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "typescript vibe commonjs\n")
})

test("extensionless imports keep native CommonJS .js interop through nested TypeScript", { skip }, (t) => {
  const { bun } = project(t, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, noEmit: true }, include: ["src/**/*"] }),
    "src/archive.vibe": 'export const archive = "archive"\n',
    "src/helper.ts": 'export { archive } from "./archive"\n',
    "cjs/package.json": '{"type":"commonjs"}',
    "cjs/index.js": 'module.exports = { local: "local" }\n',
    "node_modules/legacy-cjs/package.json": '{"main":"index.js"}',
    "node_modules/legacy-cjs/index.js": 'module.exports = { dependency: "dependency" }\n',
    "main.ts": 'import local, { local as named } from "./cjs/index.js"; import dep from "legacy-cjs"; import { archive } from "./src/helper"; console.log(archive, local.local, named, dep.dependency)\n',
    "main.cjs": 'const { archive } = require("./src/archive"); console.log(archive)\n'
  })
  for (const [entry, expected] of [["main.ts", "archive local local dependency\n"], ["main.cjs", "archive\n"]]) {
    const result = bun(["--preload", preload, entry])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, expected)
  }
})

// ./prompt.txt names no script extension, so the resolvers look for
// prompt.txt/index.ts, and Bun throws ENOTDIR where Node returns undefined.
test("the resolvers pass over a relative import of a file that is not a script", { skip: !hasBun && "bun is not on PATH" }, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-text-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "prompt.txt"), "hello\n")
  for (const module of ["packages/compiler/relative-imports.mjs", "packages/unplugin/src/relative-imports.js", "packages/vite/src/relative-imports.js"]) {
    const script = `import { extensionlessImport } from ${JSON.stringify(join(repo, module))}\nconsole.log(String(extensionlessImport(${JSON.stringify(root)}, "./prompt.txt")))`
    const result = spawnSync("bun", ["-e", script], { encoding: "utf8" })
    assert.equal(result.status, 0, `${module}: ${result.stderr}`)
    assert.equal(result.stdout, "undefined\n", module)
  }
})

// A preload pays for what it scans, and a large package's tests time out if that
// is every module of every dependency. Only a relative import can name a .vibe
// module, so the walk stops at node_modules; a workspace package's real path
// does not, so its extensionless imports still reach .vibe.
test("the preload scans a project's modules, no dependency's, and still reaches a workspace package", { skip }, (t) => {
  const tsconfig = JSON.stringify({
    compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["**/*"]
  })
  const { root, bun } = project(t, {
    "tsconfig.json": tsconfig,
    "node_modules/dep/package.json": "{\"name\":\"dep\",\"type\":\"module\",\"main\":\"index.js\"}",
    "node_modules/dep/index.js": "// dep-marker\nexport { inner } from \"./inner.js\"\n",
    "node_modules/dep/inner.js": "// dep-marker\nexport const inner = 1\n",
    "packages/lib/package.json": "{\"name\":\"lib\",\"type\":\"module\",\"main\":\"index.ts\"}",
    "packages/lib/tsconfig.json": tsconfig,
    "packages/lib/index.ts": "export { value } from \"./value\"\n",
    "packages/lib/value.vibe": "export const value: number = 41\n",
    "scan.mjs": [
      "const Original = Bun.Transpiler",
      "let dependency = 0",
      "Bun.Transpiler = function (options) {",
      "  const transpiler = new Original(options)",
      "  const scan = transpiler.scanImports.bind(transpiler)",
      "  transpiler.scanImports = (code, ...rest) => { if (code.includes(\"dep-marker\")) dependency++; return scan(code, ...rest) }",
      "  return transpiler",
      "}",
      "await import(process.env.VIBELANG_TEST_PRELOAD)",
      "process.on(\"exit\", () => console.error(`dependency modules scanned: ${dependency}`))",
      ""
    ].join("\n"),
    "main.ts": "import { inner } from \"dep\"\nimport { value } from \"lib\"\nconsole.log(inner + value)\n"
  })
  symlinkSync("../packages/lib", join(root, "node_modules/lib"))
  const result = bun(["--preload", "./scan.mjs", "main.ts"], { VIBELANG_TEST_PRELOAD: preload })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "42\n")
  assert.match(result.stderr, /dependency modules scanned: 0\n/)
})
