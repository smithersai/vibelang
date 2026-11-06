import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { fileHasVibeDirective, hasVibeDirective, isVibeLangFile } from "vibelang/source"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-directive-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  const tsconfig = {
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["src/**/*"]
  }
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', "tsconfig.json": JSON.stringify(tsconfig), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const directiveLines = [
  ["// @vibe\n", true],
  ["// @vibe", true],
  ["// @vibe\r\n", true],
  ["// @vibe \t\n", true],
  ["﻿// @vibe\n", true],
  ["#!/usr/bin/env node\n// @vibe\n", true],
  ["﻿#!/usr/bin/env node\n// @vibe\n", true],
  ["", false],
  [" // @vibe\n", false],
  ["\n// @vibe\n", false],
  ["// licence\n// @vibe\n", false],
  ["// @vibes\n", false],
  ["// @vibe please\n", false],
  ["//@vibe\n", false],
  ["/* @vibe */\n", false]
]

test("the directive reads the same in JavaScript as in the compiler", { skip }, (t) => {
  const files = Object.fromEntries(directiveLines.map(([line], index) => [`src/f${index}.ts`, line + "\nexport effect function f() {}\n"]))
  const root = project(t, files)
  const result = spawnSync(native, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
  directiveLines.forEach(([line, expected], index) => {
    const name = `src/f${index}.ts`
    const compiler = !new RegExp(`^${name.replace(".", "\\.")}\\(`, "m").test(result.stdout)
    assert.equal(compiler, expected, `the compiler on ${JSON.stringify(line)}: ${result.stdout}`)
    assert.equal(hasVibeDirective(name, files[name]), expected, `hasVibeDirective on ${JSON.stringify(line)}`)
    assert.equal(fileHasVibeDirective(join(root, name)), expected, `fileHasVibeDirective on ${JSON.stringify(line)}`)
  })
})

test("each plugin's copy of the rule is the compiler's", () => {
  const rule = readFileSync(join(repo, "packages/compiler/vibe-directive.mjs"), "utf8")
  for (const copy of ["packages/vite/src/vibe-directive.js", "packages/unplugin/src/vibe-directive.js"]) {
    assert.equal(readFileSync(join(repo, copy), "utf8"), rule, copy)
  }
})

test("only a TypeScript source has the directive", () => {
  for (const name of ["a.ts", "a.tsx", "a.mts", "a.cts"]) assert.equal(hasVibeDirective(name, "// @vibe\n"), true, name)
  for (const name of ["a.d.ts", "a.d.mts", "a.d.cts", "a.d.css.ts", "a.d.vibe.ts", "a.js", "a.mjs", "a.json", "a.vibe", "a.vibex"]) {
    assert.equal(hasVibeDirective(name, "// @vibe\n"), false, name)
  }
})

test("text after the directive line never changes the verdict, and a file without it stays TypeScript", () => {
  fc.assert(fc.property(fc.string({ unit: "binary" }), (rest) => {
    assert.equal(hasVibeDirective("a.ts", "// @vibe\n" + rest), true)
    if (!rest.replace(/^﻿/, "").startsWith("#!") && !rest.replace(/^﻿/, "").startsWith("// @vibe")) {
      assert.equal(hasVibeDirective("a.ts", rest), false)
    }
  }))
})

test("isVibeLangFile reads a file past a long #! line, and a missing file is not VibeLang", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-directive-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const long = join(root, "long.ts")
  writeFileSync(long, "#!/usr/bin/env node " + "x".repeat(8192) + "\n// @vibe\n")
  assert.equal(isVibeLangFile(long), true)
  assert.equal(isVibeLangFile(join(root, "missing.ts")), false)
  assert.equal(isVibeLangFile(join(root, "missing.vibe")), true)
})

test("vibelang/register runs a .ts module with the directive and leaves a plain .ts module to Node", { skip }, (t) => {
  const root = project(t, {
    "src/hello.ts": '// @vibe\nimport { suffix } from "./plain.ts"\nerror Empty\neffect function greet(name: string) {\n  if (name === "") throw new Empty()\n  return `hello ${name}${suffix}`\n}\nexport effect function main() {\n  const who = greet("") catch () => "nobody"\n  return try greet(who)\n}\n',
    "src/plain.ts": 'export const suffix: string = "!"\n',
    "src/run.ts": 'import { Effect } from "effect"\nimport { main } from "./hello.ts"\nconsole.log(await Effect.runPromise(main()))\n'
  })
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
  config.compilerOptions.allowImportingTsExtensions = true
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
  const run = (flags) => spawnSync(process.execPath, [...flags, "src/run.ts"], {
    cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") }
  })
  const loaded = run(["--import", register])
  assert.equal(loaded.status, 0, loaded.stderr)
  assert.equal(loaded.stdout, "hello nobody!\n")
  const stock = run([])
  assert.notEqual(stock.status, 0, "Node without the loader must refuse the file")
  assert.match(stock.stderr, /SyntaxError|ERR_INVALID_TYPESCRIPT_SYNTAX/)
})

test("vibelang format writes a .ts file with the directive and leaves a plain one alone", { skip }, (t) => {
  const vibelang = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
  const root = project(t, {
    "src/hello.ts": "// @vibe\neffect   function f( ) {\n  return   1\n}\nexport { f }\n",
    "src/plain.ts": "export   const n = 1\n"
  })
  const env = { ...process.env, VIBELANG_BINARY: native }
  const check = spawnSync(process.execPath, [vibelang, "format", "--check"], { cwd: root, encoding: "utf8", env })
  assert.equal(check.status, 1, check.stderr)
  assert.match(check.stderr, /src\/hello\.ts: needs formatting/)
  assert.doesNotMatch(check.stderr, /plain/)
  const write = spawnSync(process.execPath, [vibelang, "format", "--write"], { cwd: root, encoding: "utf8", env })
  assert.equal(write.status, 0, write.stderr)
  assert.equal(readFileSync(join(root, "src/hello.ts"), "utf8"), "// @vibe\neffect function f() {\n  return 1\n}\nexport { f }\n")
  assert.equal(readFileSync(join(root, "src/plain.ts"), "utf8"), "export   const n = 1\n")
})

test("vibelang lint reads a .ts file with the directive", { skip }, (t) => {
  const vibelang = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
  const root = project(t, { "src/hello.ts": "// @vibe\nexport const value = 1\n" })
  const result = spawnSync(process.execPath, [vibelang, "lint"], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native } })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
