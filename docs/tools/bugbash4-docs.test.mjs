import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

test("CLI reference watch distinguishes selected inputs from the reference graph", () => {
  const text = read("docs/user/src/setup/vibelang-cli.md")
  assert.match(text, /vibelang -b -w/)
  assert.match(text, /selected project/)
})

test("both Bun loader entry points disclose the observed watch limit and dev alternative", () => {
  for (const path of ["packages/compiler/README.md", "docs/user/src/setup/vibelang-cli.md"]) {
    const text = read(path)
    assert.match(text, /Bun 1\.4\.1.*`bun --watch --preload vibelang\/bun`/)
    assert.match(text, /does not reliably restart/)
    assert.match(text, /bun run dev/)
  }
})

test("Bun test instructions install and enable declarations before running Effects", () => {
  for (const path of ["packages/compiler/README.md", "docs/user/src/setup/vibelang-cli.md"]) {
    const text = read(path)
    for (const part of ["bun add -d @types/bun", '"types": ["bun"]', '[test]', 'preload = ["vibelang/bun"]', 'from "bun:test"', "Effect.runSync(greeting("]) assert.ok(text.includes(part), part)
  }
})

test("runtime export table covers every built JavaScript root export", async (t) => {
  let runtime
  try { runtime = await import("../../packages/runtime/dist/index.js") }
  catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") return t.skip("build packages/runtime first"); throw error }
  const table = read("packages/runtime/README.md").split("## Public exports")[1].split(/\n## /)[0]
  for (const name of Object.keys(runtime)) assert.ok(table.includes(`\`${name}\``), `undocumented root export: ${name}`)
})

test("CLI documents configuration tools and the initializer's ESM boundary", () => {
  const text = read("docs/user/src/setup/vibelang-cli.md")
  for (const part of ["--init", "--showConfig", "--ignoreConfig", '"type": "module"', "generic"]) assert.ok(text.includes(part), part)
})

test("editor setup names the registered discovery and editing capabilities", () => {
  const text = read("docs/user/src/setup/vscode.md").toLowerCase()
  for (const part of ["call hierarchy", "type definition", "workspace symbols", "signature help", "selection ranges", "document highlights", "inlay hints", "code lens", "linked editing", "on-type formatting"]) assert.ok(text.includes(part), part)
})

test("published editor setup exposes the shipped server controls", () => {
  const text = read("docs/user/src/setup/vscode.md")
  const manifest = JSON.parse(read("editors/vscode/package.json"))
  for (const key of ["vibelang.server.path", "vibelang.server.typeScriptFiles", "vibelang.trace.server"]) {
    assert.ok(manifest.contributes.configuration.properties[key])
    assert.ok(text.includes(key), key)
  }
  for (const part of ["VibeLang: Restart Language Server", "VibeLang: Show Language Server Output", '"messages"', '"verbose"']) assert.ok(text.includes(part), part)
})

test("scaffolder options include both aliases for help and version", () => {
  const text = read("packages/create-vibelang/README.md")
  for (const flag of ["-h", "--help", "-v", "--version"]) assert.ok(text.includes(`\`${flag}\``), flag)
})

test("essentials declares its example layer binding", () => {
  assert.match(read("docs/user/llms-essentials.md"), /`const UsersLive = Layer\.succeed/)
})

test("framework recipes retain VibeLang checking and run Effects before rendering", () => {
  const text = read("docs/user/src/setup.md")
  for (const part of ['vibelang-unplugin/webpack', 'next build --webpack', 'vibelang --noEmit && next build --webpack', 'ignoreBuildErrors', 'entire checker', 'vite: { plugins: [vibelang()] }', 'Effect.runSync(greet("Astro"))', '<h1>{message}</h1>']) assert.ok(text.includes(part), part)
})

test("declaration consumers have an explicit stock TypeScript compatibility floor", () => {
  const text = read("docs/user/src/getting-started/004-installation.md")
  for (const part of ["TypeScript 5.7 or later", "effect@4.1.0", "Uint8Array<ArrayBuffer>", "consumer requirement", "skipLibCheck"]) assert.ok(text.includes(part), part)
})

test("every EK code the skill names is one the compiler reports", () => {
  const dir = "typescript/tsc/internal/vibelang"
  const sources = readdirSync(new URL(`../../${dir}`, import.meta.url)).filter(name => name.endsWith(".go") && !name.endsWith("_test.go"))
  const codes = new Set(sources.flatMap(name => [...read(`${dir}/${name}`).matchAll(/\bmessage\((\d{4}),/g)].map(m => `EK${m[1]}`)))
  assert.ok(codes.has("EK2001") && codes.has("EK4801") && codes.has("EK4836"), "the registry scan found the compiler's codes")
  const named = [...read("packages/compiler/skills/vibelang/SKILL.md").matchAll(/\bEK\d{4}\b/g)].map(m => m[0])
  assert.ok(named.length >= 5)
  assert.deepEqual(named.filter(code => !codes.has(code)), [])
})
