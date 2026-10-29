import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

const tsconfig = (include) => JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  },
  include
})

// A scratch project whose compiler records each invocation in calls.jsonl.
function project(t, files, prefix = "vibelang-register-") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
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
  const run = (entry, env = {}, flags = ["--enable-source-maps"]) =>
    spawnSync(process.execPath, [...flags, "--import", register, entry], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), ...env }
    })
  const compilations = () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0
  return { root, run, compilations }
}

test("runs .vibe modules imported from TypeScript, with one compile and one copy of each module", { skip }, (t) => {
  const { run, compilations } = project(t, {
    "src/helper.ts": "export const marker = { id: \"helper\" }\n",
    "src/shout.vibe": "export function shout(text: string): string { return text.toUpperCase() }\n",
    // A plain function never fails (D282); a JavaScript exception from a
    // property access still propagates, with its .vibe frame.
    "src/boom.vibe": "export function boom(): number {\n  const broken: any = undefined; return broken.length\n}\n",
    "src/greet.vibe": [
      "import { marker } from \"./helper.ts\"",
      "import { shout } from \"./shout.vibe\"",
      "export const seen = marker",
      "export function greet(name: string) {",
      "  return shout(`Hello, ${name}`)",
      "}",
      ""
    ].join("\n"),
    "src/main.ts": [
      "import { Effect } from \"effect\"",
      "import { boom } from \"./boom.vibe\"",
      "import { greet, seen } from \"./greet.vibe\"",
      "import { marker } from \"./helper.ts\"",
      "let stack = \"\"",
      "try { boom() } catch (error) { stack = String((error as Error).stack) }",
      "console.log(JSON.stringify({ text: Effect.runSync(greet(\"Ada\")), same: seen === marker, mapped: /boom\\.vibe:2/.test(stack) }))",
      ""
    ].join("\n")
  })
  const result = run("src/main.ts")
  assert.equal(result.stderr, "")
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { text: "HELLO, ADA", same: true, mapped: true })
  assert.equal(compilations(), 1, "every .vibe module of a project comes from one compile")
})

test("loads a .vibe module's module declaration as a module of its own, with stack frames inside it (D283, D403)", { skip }, (t) => {
  const { run, compilations } = project(t, {
    "src/suffix.ts": "export const suffix = \"!\"\n",
    "src/shout.vibe": "export function shout(text: string): string { return text.toUpperCase() }\n",
    "src/text.vibe": [
      "module tools {",
      "  export function clean(value: string): string {",
      "    if (value.trim() === \"\") throw new Error(\"empty\")",
      "    cleaned++",
      "    return shout(value.trim()) + suffix",
      "  }",
      "  export let cleaned = 0",
      "  export const url = import.meta.url",
      "  import { suffix } from \"./suffix.ts\"",
      "  import { shout } from \"./shout.vibe\"",
      "}",
      "import { clean } from tools",
      "export { cleaned, url } from tools",
      "export function tidy(value: string) {",
      "  return sync((value) => clean(value), value)",
      "}",
      ""
    ].join("\n"),
    "src/main.ts": [
      "import { Cause, Effect, Exit } from \"effect\"",
      "import { cleaned, tidy, url } from \"./text.vibe\"",
      "const exit = Effect.runSyncExit(tidy(\"  \"))",
      "const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) as Error : undefined",
      "const text = Effect.runSync(tidy(\"  a  \"))",
      "console.log(JSON.stringify({ text, cleaned, url: url.endsWith(\"/src/text.vibe.tools.js\"), defect: defect?.message, mapped: /text\\.vibe:3:/.test(String(defect?.stack)) }))",
      ""
    ].join("\n")
  })
  const result = run("src/main.ts")
  assert.equal(result.stderr, "")
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { text: "A!", cleaned: 1, url: true, defect: "empty", mapped: true })
  assert.equal(compilations(), 1)
})

test("resolves an extensionless import to the .vibe file TypeScript resolves it to", { skip }, (t) => {
  const bundler = JSON.stringify({
    compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["script/**/*", "src/**/*"]
  })
  const { run } = project(t, {
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
  const result = run("script/run.ts")
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "archive mounted archive!\n")
})

test("reports the compiler's diagnostics when the project does not compile", { skip }, (t) => {
  const { run } = project(t, {
    "src/bad.vibe": "export const count: number = \"three\"\n",
    "src/main.ts": "import { count } from \"./bad.vibe\"\nconsole.log(count)\n"
  })
  const result = run("src/main.ts")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /did not compile/)
  assert.match(result.stderr, /bad\.vibe:1:\d+ - error TS2322/)
})

test("VIBELANG_REGISTER_DEBUG times each compile's stages and, at exit, what the hook took", { skip }, (t) => {
  const { run } = project(t, {
    "src/shout.vibe": "export function shout(text: string): string { return text.toUpperCase() }\n",
    // Emitted as ./shout.js, which the hook resolves to shout.vibe.
    "src/greet.vibe": "import { shout } from \"./shout.vibe\"\n\nexport function greet(name: string): string { return shout(name) }\n",
    "src/main.ts": "import { greet } from \"./greet.vibe\"\nconsole.log(greet(\"ada\"))\n"
  })
  const result = run("src/main.ts", { VIBELANG_REGISTER_DEBUG: "1" })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "ADA\n")
  const lines = result.stderr.trim().split("\n")
  assert.equal(lines.length, 2, result.stderr)
  assert.match(lines[0], /^vibelang\/register: compiled .*\/tsconfig\.json in \d+ms \(no entry\): lookup \d+ms, snapshot \d+ms, compiler \d+ms, collect \d+ms, store \d+ms; 2 modules, \d+ files read$/)
  assert.match(lines[1], /^vibelang\/register: 1 project compiled or read from the cache in \d+ms, 2 modules loaded in \d+ms, 1 import resolved to its source in \d+ms$/)
  const warm = run("src/main.ts", { VIBELANG_REGISTER_DEBUG: "1" })
  assert.match(warm.stderr, /^vibelang\/register: .*\/tsconfig\.json from the cache in \d+ms$/m)
})

test("names VIBELANG_PROJECT when the nearest tsconfig does not include a module, and honors it", { skip }, (t) => {
  const { root, run } = project(t, {
    "tsconfig.tools.json": tsconfig(["src/**/*", "tools/**/*"]),
    "src/index.ts": "export {}\n",
    "tools/answer.vibe": "export const answer: number = 42\n",
    "tools/run.ts": "import { answer } from \"./answer.vibe\"\nconsole.log(answer)\n"
  })
  const refused = run("tools/run.ts")
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /does not include .*answer\.vibe; set VIBELANG_PROJECT/)
  const accepted = run("tools/run.ts", { VIBELANG_PROJECT: join(root, "tsconfig.tools.json") })
  assert.equal(accepted.stderr, "")
  assert.equal(accepted.stdout, "42\n")
})

test("VIBELANG_PROJECT compiles its own modules; another workspace package's source compiles with its own tsconfig", { skip }, (t) => {
  const { root, run } = project(t, {
    "app/package.json": '{"type":"module"}',
    "app/tsconfig.json": tsconfig(["src/**/*"]),
    "app/tsconfig.tools.json": tsconfig(["tools/**/*"]),
    "app/tools/answer.vibe": "import { value } from \"../../lib/src/value.vibe\"\nexport const answer: number = value + 1\n",
    "app/tools/run.ts": "import { answer } from \"./answer.vibe\"\nconsole.log(answer)\n",
    "lib/package.json": '{"type":"module"}',
    "lib/tsconfig.json": tsconfig(["src/**/*"]),
    "lib/src/value.vibe": "export const value: number = 41\n"
  })
  const result = run("app/tools/run.ts", { VIBELANG_PROJECT: join(root, "app/tsconfig.tools.json") })
  assert.equal(result.stderr, "")
  assert.equal(result.stdout, "42\n")
})

test("a long-running process loads a .vibe module written or edited after its project compiled", { skip }, (t) => {
  const { root, run, compilations } = project(t, {
    "src/first.vibe": "export function first(): string { return \"first\" }\n",
    // Outside the project's include, so the compiler does not check it.
    "tools/main.ts": [
      "import { writeFileSync } from \"node:fs\"",
      "import { first } from \"../src/first.vibe\"",
      "const seen = [first()]",
      "// A module that did not exist when the project compiled, as a registry's content-pinned copy.",
      "writeFileSync(new URL(\"../src/later.vibe\", import.meta.url), \"export function later(): string { return \\\"later\\\" }\\n\")",
      "seen.push((await import(\"../src/later.vibe\")).later())",
      "// An edited module, imported again under a new URL, as a watcher does.",
      "writeFileSync(new URL(\"../src/first.vibe\", import.meta.url), \"export function first(): string { return \\\"edited\\\" }\\n\")",
      "seen.push((await import(\"../src/first.vibe?edit=1\")).first())",
      "console.log(JSON.stringify(seen))",
      ""
    ].join("\n")
  })
  const result = run("tools/main.ts")
  assert.equal(result.stderr, "")
  assert.deepEqual(JSON.parse(result.stdout), ["first", "later", "edited"])
  assert.equal(compilations(), 3)
  assert.ok(existsSync(join(root, "src/later.vibe")))
})

test("a failed compile and a module outside the project throw errors with a code", { skip }, (t) => {
  const { run } = project(t, {
    "src/good.vibe": "export const good: number = 1\n",
    "broken/tsconfig.json": tsconfig(["src/**/*"]),
    "broken/src/bad.vibe": "export const count: number = \"three\"\n",
    "elsewhere/stray.vibe": "export const stray: number = 1\n",
    "tools/check.ts": [
      "for (const specifier of [\"../src/good.vibe\", \"../broken/src/bad.vibe\", \"../elsewhere/stray.vibe\"]) {",
      "  try { await import(specifier); console.log(\"loaded\") } catch (error) { console.log((error as { code?: string }).code) }",
      "}",
      ""
    ].join("\n")
  })
  const result = run("tools/check.ts")
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.trim().split("\n"), ["loaded", "ERR_VIBELANG_COMPILE", "ERR_VIBELANG_PROJECT"])
})

test("stack traces name .vibe lines without --enable-source-maps", { skip }, (t) => {
  const { run } = project(t, {
    // The error declaration emits more lines than it takes, so an unmapped
    // frame would name a later line of boom.vibe.
    "src/boom.vibe": "error Refused { reason: string }\n\nexport function boom(): number!Refused {\n  throw new Refused({ reason: \"boom\" })\n}\n",
    "src/main.ts": [
      "import { Effect } from \"effect\"",
      "import { boom } from \"./boom.vibe\"",
      "const failure = Effect.runSync(Effect.flip(boom()))",
      "console.log(String(failure.stack).split(\"\\n\").filter((line) => line.includes(\"boom.vibe\")).join(\"\\n\"))",
      ""
    ].join("\n")
  })
  const result = run("src/main.ts", {}, [])
  assert.equal(result.stderr, "")
  assert.match(result.stdout, /boom\.vibe:4:\d+\)?$/m)
})

test("the inline source map names each .vibe source by file URL, in a directory with a space, # and %", { skip }, (t) => {
  // A source map's sources are URLs resolved against the module's URL, so a
  // Windows path such as C:/app/main.vibe would read as the scheme c:.
  const { root, run } = project(t, {
    "src/boom.vibe": "export function boom(): number { return 1 }\n",
    "src/main.ts": [
      "import { registerHooks } from \"node:module\"",
      "let source = \"\"",
      "registerHooks({ load(url, context, nextLoad) { const result = nextLoad(url, context); if (url.endsWith(\"boom.vibe\")) source = String(result.source); return result } })",
      "await import(\"./boom.vibe\")",
      "const inline = /sourceMappingURL=data:application\\/json;base64,(\\S+)/.exec(source)![1]",
      "console.log(JSON.stringify(JSON.parse(Buffer.from(inline, \"base64\").toString()).sources))",
      ""
    ].join("\n")
  }, "vibelang register #%-")
  const result = run("src/main.ts")
  assert.equal(result.stderr, "")
  assert.deepEqual(JSON.parse(result.stdout), [pathToFileURL(join(root, "src/boom.vibe")).href])
})

test("the published modules hold no line that reads as their own inline source map", () => {
  // source-map-support, which Playwright loads, takes the last match of this
  // pattern in a module's text as that module's own source map.
  const comment = /(?:\/\/[@#][\s]*sourceMappingURL=([^\s'"]+)[\s]*$)|(?:\/\*[@#][\s]*sourceMappingURL=([^\s*'"]+)[\s]*(?:\*\/)[\s]*$)/m
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"))
  for (const name of manifest.files.filter((file) => file.endsWith(".mjs"))) {
    const text = readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8")
    assert.doesNotMatch(text, comment, name)
  }
})

test("an included node_modules source without loader output reports the output limitation, including cache hits", { skip }, (t) => {
  const { root, run } = project(t, {
    "node_modules/dualtest/package.json": '{"name":"dualtest","type":"module","exports":"./greeting.vibe"}',
    "node_modules/dualtest/greeting.vibe": 'export const greeting: string = "hello"\n',
    "src/main.ts": 'import { greeting } from "dualtest"\nconsole.log(greeting)\n'
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run("src/main.ts", { VIBELANG_PROJECT: join(root, "tsconfig.json") })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /ERR_VIBELANG_OUTPUT/)
    assert.match(result.stderr, /includes .*greeting\.vibe.*no loader output/)
    assert.doesNotMatch(result.stderr, /set VIBELANG_PROJECT/)
  }
})

test("loads a clean module despite unrelated baseline errors, but rejects a loaded bad module", { skip }, (t) => {
  const { run } = project(t, {
    "src/value.vibe": 'export const value = 42\n',
    "src/bad.vibe": 'export const value: number = "bad"\n',
    "src/unrelated.ts": 'export const baseline: number = "bad"\n',
    "main.ts": 'import { value } from "./src/value.vibe"; console.log(value)\n',
    "bad.ts": 'import { value } from "./src/bad.vibe"; console.log(value)\n'
  })
  const clean = run("main.ts")
  assert.equal(clean.status, 0, clean.stderr)
  assert.equal(clean.stdout, "42\n")
  const bad = run("bad.ts")
  assert.notEqual(bad.status, 0)
  assert.match(bad.stderr, /bad\.vibe:1:\d+ - error TS2322/)
  assert.doesNotMatch(bad.stderr, /unrelated\.ts/)
})

test("configuration diagnostics retain their original location at every load", { skip }, (t) => {
  const { run } = project(t, {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: "invalid" }, include: ["src/**/*"]
    }),
    "src/value.vibe": "export const value = 42\n",
    "main.ts": 'import { value } from "./src/value.vibe"; console.log(value)\n'
  })
  const result = run("main.ts")
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /tsconfig\.json:1:\d+ - error TS5024/)
})
