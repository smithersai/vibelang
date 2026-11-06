import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const shim = join(repo, "packages/typescript-shim")
const compiler = join(repo, "packages/compiler")
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const runtime = join(repo, "packages/runtime")
// The runtime's own copy, so a project and the runtime share one effect.
const effect = join(runtime, "node_modules/effect")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

const hello = `// @vibe
error Empty

effect function greet(name: string) {
  if (name === "") throw new Empty()
  return \`hello \${name}\`
}

export effect function main() {
  const who = greet("") catch () => "nobody"
  return try greet(who)
}
`

// A project laid out as npm lays out `"typescript": "npm:vibelang-typescript@…"`.
function project(t, files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-shim-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  cpSync(shim, join(root, "node_modules/typescript"), { recursive: true, filter: (path) => !path.includes("/test") && !path.endsWith("/node_modules") })
  symlinkSync(compiler, join(root, "node_modules/vibelang"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  symlinkSync("../typescript/bin/tsc", join(root, "node_modules/.bin/tsc"))
  const tsconfig = {
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, outDir: "out", rootDir: "src", declaration: true },
    include: ["src"]
  }
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', "tsconfig.json": JSON.stringify(tsconfig), "src/hello.ts": hello, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const tsc = (root, args = [], bin = "node_modules/.bin/tsc") =>
  spawnSync(join(root, bin), args, { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native } })

test("tsc is the VibeLang compiler", { skip }, (t) => {
  const result = tsc(project(t), ["--version"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^VibeLang \d+\.\d+\.\d+ \(TypeScript 7\.1/)
})

test("tsc checks and emits VibeLang in a .ts file, and the output runs", { skip }, (t) => {
  const root = project(t)
  const result = tsc(root)
  assert.equal(result.status, 0, result.stdout)
  assert.equal(result.stdout, "")
  assert.ok(existsSync(join(root, "out/hello.js")))
  assert.ok(existsSync(join(root, "out/hello.d.ts")))
  assert.ok(!existsSync(join(root, "src/hello.d.vibe.ts")), "a .ts source has no sidecar")
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { Effect } from "effect"
    import { main } from ${JSON.stringify(pathToFileURL(join(root, "out/hello.js")).href)}
    console.log(await Effect.runPromise(main()))`], { cwd: root, encoding: "utf8" })
  assert.equal(run.stdout, "hello nobody\n", run.stderr)
})

test("tsc reports TypeScript's and VibeLang's errors with their exit status", { skip }, (t) => {
  const type = tsc(project(t, { "src/hello.ts": "// @vibe\nexport effect function f() {\n  return nope\n}\n" }))
  assert.equal(type.status, 2)
  assert.match(type.stdout, /src\/hello\.ts\(3,10\): error TS2304/)
  const rule = tsc(project(t, { "src/hello.ts": "// @vibe\nexport function f() {\n  throw new Error('no')\n}\n" }))
  assert.equal(rule.status, 2)
  assert.match(rule.stdout, /src\/hello\.ts\(3,3\): error EK0401/)
})

test("a .ts file without the directive keeps TypeScript's verdict", { skip }, (t) => {
  const root = project(t, { "src/hello.ts": hello.replace("// @vibe\n", "") })
  const result = tsc(root)
  assert.equal(result.status, 2)
  assert.match(result.stdout, /src\/hello\.ts\(1,1\): error TS1434/)
  assert.doesNotMatch(result.stdout, /EK\d/)
})

test("the package answers as typescript does, and fails plainly for what it lacks", { skip }, (t) => {
  const root = project(t)
  const load = (source) => spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: root, encoding: "utf8" })
  const version = load(`import ts from "typescript"; console.log(ts.version, ts.versionMajorMinor)`)
  const { version: published } = JSON.parse(readFileSync(join(shim, "package.json"), "utf8"))
  assert.equal(version.stdout, `${published} ${published.split(".").slice(0, 2).join(".")}\n`, version.stderr)
  const api = load(`await import("typescript/sync")`)
  assert.notEqual(api.status, 0)
  assert.match(api.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/)
})

test("a vibelang at another version stops tsc with both versions named", { skip }, (t) => {
  const root = project(t)
  rmSync(join(root, "node_modules/vibelang"))
  cpSync(compiler, join(root, "node_modules/vibelang"), { recursive: true, filter: (path) => !/\/(native|node_modules|test)$/.test(path) })
  const path = join(root, "node_modules/vibelang/package.json")
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), version: "0.0.1" }))
  const result = tsc(root)
  assert.equal(result.status, 1)
  const { version, dependencies } = JSON.parse(readFileSync(join(shim, "package.json"), "utf8"))
  assert.match(result.stderr, new RegExp(`vibelang-typescript ${version} needs vibelang ${dependencies.vibelang}, but vibelang 0\\.0\\.1 is installed`))
})

for (const bin of ["node_modules/.bin/tsc", "node_modules/typescript/lib/tsc", "node_modules/typescript/tsc"]) {
  test(`the language server behind ${bin} reads the directive live`, { skip }, async (t) => {
    const root = project(t, { "src/plain.ts": "export const n: number = 1\n" })
    const server = new Connection(join(root, bin), ["--lsp", "--stdio"], root)
    t.after(() => server.process.kill())
    const uri = pathToFileURL(join(root, "src/hello.ts")).href
    const opened = await server.request("initialize", {
      processId: process.pid, rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: "project" }],
      capabilities: { textDocument: { diagnostic: { dynamicRegistration: false }, hover: { contentFormat: ["markdown", "plaintext"] } } }
    })
    assert.equal(opened.serverInfo.name, "vibelang")
    server.notify("initialized", {})
    server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text: hello } })
    const diagnostics = async () => (await server.request("textDocument/diagnostic", { textDocument: { uri } })).items
    assert.deepEqual(await diagnostics(), [])
    const hover = await server.request("textDocument/hover", { textDocument: { uri }, position: { line: 3, character: 18 } })
    assert.match(hover.contents.value, /string!Empty/)
    const change = (version, text) => server.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] })
    change(2, hello.replace("return `hello", "return nope + `hello"))
    assert.deepEqual((await diagnostics()).map((d) => d.code), [2304])
    change(3, hello.replace("// @vibe\n", ""))
    assert.ok((await diagnostics()).some((d) => d.code === 1434), "without the directive the file is TypeScript")
    await server.request("shutdown")
    server.notify("exit")
  })
}

for (const tsdk of ["node_modules/typescript", "node_modules/typescript/lib"]) {
  test(`TypeScript's VS Code extension finds the compiler through a tsdk of ${tsdk}`, { skip }, (t) => {
    const root = project(t)
    const discovery = fileURLToPath(new URL("./vscode-discovery.mjs", import.meta.url))
    const source = join(repo, "typescript/packages/vscode-typescript/src")
    const compiled = join(root, "extension")
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    spawnSync(native, ["--noCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck", "--rootDir", source, "--outDir", compiled, join(source, "util.ts"), join(source, "tsdkPackage.ts")], { cwd: root })
    const found = spawnSync(process.execPath, [discovery, compiled, join(root, tsdk)], { cwd: root, encoding: "utf8" })
    assert.equal(found.status, 0, found.stderr)
    const exe = JSON.parse(found.stdout)
    assert.equal(exe?.path, join(root, tsdk, "tsc"), found.stdout)
    const version = spawnSync(exe.path, ["--version"], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native } })
    assert.match(version.stdout, /^VibeLang /, version.stderr)
  })
}
