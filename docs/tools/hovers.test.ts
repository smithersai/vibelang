import { afterAll, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { baseKey, cacheFile, type PageHovers, sanitize, trimDocs, updateHovers, words } from "./hovers"
import { leaks } from "./leaks"

test("hovers identifiers, keywords, the topic, and template substitutions, not comments or strings", () => {
  const code = 'const n = f("x y") // note\nconst s = `${n.length} and ${g({ a: 1 })}`\nreturn % + 1'
  expect(words(code).map(w => [w.target, code.slice(w.start, w.start + w.target.length)]).map(([t, s]) => t === s ? t : `${t}!=${s}`))
    .toEqual(["const", "n", "f", "const", "s", "n", "length", "g", "a", "return", "%"])
})

test("keeps VibeLang's notes and the JSDoc's first paragraph", () => {
  expect(trimDocs("Runs here and returns `void`.\n\nLogs one or more messages.\nAt the default level.\n\n**Example**\n\n```ts\nEffect.log(1)\n```\n\n*@since* — 2.0.0"))
    .toBe("Runs here and returns `void`.\n\nLogs one or more messages.\nAt the default level.")
  expect(trimDocs("*@category* — constructors")).toBe("")
  expect(trimDocs("")).toBe("")
})

test("splits VibeLang's notes from the JSDoc at the server's rule", () => {
  // Notes the opening list does not know stay notes when the rule marks them.
  expect(trimDocs("A brand-new note.\n\nAnother one.\n\n---\n\nLogs one or more messages.\n\n**Example**\n\n```ts\nEffect.log(1)\n```"))
    .toBe("A brand-new note.\n\nAnother one.\n\nLogs one or more messages.")
  expect(trimDocs("A brand-new note.\n\n---\n\n*@since* — 2.0.0")).toBe("A brand-new note.")
  // Without a rule, a hover with only notes keeps them.
  expect(trimDocs("Runs here and returns `void`.")).toBe("Runs here and returns `void`.")
})

test("strips local links and paths", () => {
  const raw = "Like [`String`](file:///Users/someone/vibelang/packages/runtime/node_modules/effect/src/Config.ts#1439,17-1439,23) " +
    "from /Users/someone/vibelang/packages/runtime/node_modules/effect/dist/Config.d.ts in /private/var/folders/x/T/vibelang-hovers-1/3/block-1.vibe"
  expect(leaks(raw)).not.toEqual([])
  const clean = sanitize(raw, ["/private/var/folders/x/T/vibelang-hovers-1/3"])
  expect(clean).toBe("Like `String` from effect/dist/Config.d.ts in ./block-1.vibe")
  expect(leaks(clean)).toEqual([])
})

// The cache tests drive the local compiler through a wrapper script: the
// cache key hashes the compiler file, so editing the wrapper stands in for a
// rebuilt binary without copying it.
const native = resolve(import.meta.dir, "../../packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")
const legacy = resolve(import.meta.dir, "../../typescript/built/local/tsc")
const selected = process.env.VIBELANG_BINARY || (existsSync(native) ? native : legacy)
const compiler = Bun.which(selected) ?? resolve(selected)
const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hovers-test-"))
  roots.push(root)
  const cache = join(root, "cache")
  const wrapper = join(root, "vibelang")
  const page = join(root, "src/page.md")
  const writeWrapper = (build: number) => {
    writeFileSync(wrapper, `#!/bin/sh\n# build ${build}\nexec "${compiler}" "$@"\n`)
    chmodSync(wrapper, 0o755)
  }
  const writePage = (name: string) => {
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(page, ["# Page", "", "```vibe", 'import { Effect } from "effect"', "",
      "/** Wraps {@link Effect.succeed} for the docs. */", `function ${name}(n: number) {`, "  return n + 1", "}", `const answer = ${name}(41)`, "```", ""].join("\n"))
  }
  const run = () => updateHovers({ compiler: wrapper, root, cache })
  const entry = (): PageHovers => JSON.parse(readFileSync(join(cache, "src/page.json"), "utf8"))
  return { root, cache, writeWrapper, writePage, run, entry }
}

test.skipIf(!existsSync(compiler))("a second run reuses the page's entry", async () => {
  const { cache, writeWrapper, writePage, run, entry } = fixture()
  writeWrapper(1)
  writePage("wrap")
  expect(await run()).toMatchObject({ pages: 1, hits: 0, misses: 1 })
  const first = readFileSync(join(cache, "src/page.json"), "utf8")
  expect(await run()).toMatchObject({ pages: 1, hits: 1, misses: 0 })
  expect(readFileSync(join(cache, "src/page.json"), "utf8")).toBe(first)
  const hover = entry().blocks[0].nodes.find(n => n.type === "hover" && n.target === "wrap")
  expect(hover).toMatchObject({ type: "hover", line: 3, character: 9, text: "function wrap(n: number): number" })
}, 60_000)

test.skipIf(!existsSync(compiler))("editing a block refreshes its page", async () => {
  const { cache, writeWrapper, writePage, run, entry } = fixture()
  writeWrapper(1)
  writePage("wrap")
  await run()
  writePage("increment")
  expect(await run()).toMatchObject({ hits: 0, misses: 1 })
  expect(entry().blocks[0].nodes.some(n => n.type === "hover" && n.target === "increment")).toBe(true)
  expect(entry().blocks[0].nodes.some(n => n.type === "hover" && n.target === "wrap")).toBe(false)
}, 60_000)

test.skipIf(!existsSync(compiler))("a rebuilt compiler refreshes every page", async () => {
  const { cache, writeWrapper, writePage, run, entry } = fixture()
  writeWrapper(1)
  writePage("wrap")
  await run()
  expect(await run()).toMatchObject({ hits: 1, misses: 0 })
  writeWrapper(2)
  expect(await run()).toMatchObject({ hits: 0, misses: 1 })
}, 60_000)

test.skipIf(!existsSync(compiler))("no cached text contains a forbidden string", async () => {
  const { cache, writeWrapper, writePage, run, entry } = fixture()
  writeWrapper(1)
  writePage("increment")
  await run()
  const text = readFileSync(join(cache, "src/page.json"), "utf8")
  expect(leaks(text)).toEqual([])
  expect(text).not.toContain("file:")
  // The server links Effect.succeed to its source in the build machine's
  // node_modules; the link's text remains.
  const hover = entry().blocks[0].nodes.find(n => n.type === "hover" && n.target === "increment" && n.line === 3)
  expect(hover?.type === "hover" && hover.docs).toBe(
    "Wraps Effect.succeed for the docs.")
}, 60_000)

test("another runtime directory changes every page's key", () => {
  const { root } = fixture()
  const runtime = (name: string, declarations: string) => {
    const dir = join(root, name)
    mkdirSync(join(dir, "dist"), { recursive: true })
    writeFileSync(join(dir, "package.json"), '{"name":"vibelang-runtime","version":"0.0.1"}')
    writeFileSync(join(dir, "dist/index.d.ts"), declarations)
    return dir
  }
  const binary = join(root, "key-binary")
  writeFileSync(binary, "binary")
  const keyWith = (dir: string) => {
    const saved = process.env.VIBELANG_RUNTIME_DIR
    process.env.VIBELANG_RUNTIME_DIR = dir
    try { return baseKey(binary) } finally { if (saved === undefined) delete process.env.VIBELANG_RUNTIME_DIR; else process.env.VIBELANG_RUNTIME_DIR = saved }
  }
  const release = runtime("runtime-release", "export declare const a: 1\n")
  expect(keyWith(release)).toBe(keyWith(release))
  expect(keyWith(runtime("runtime-other", "export declare const a: 2\n"))).not.toBe(keyWith(release))
})

test("cacheFile never escapes the cache directory for pages outside root", () => {
  const repoRoot = resolve(import.meta.dir, "../..")
  const docsRoot = join(repoRoot, "docs/user")
  const cacheDir = join(repoRoot, ".cache/docs-hovers")
  const inside = cacheFile(cacheDir, docsRoot, join(docsRoot, "src/001-onboarding.md"))
  const outsideReadme = cacheFile(cacheDir, docsRoot, join(repoRoot, "README.md"))
  const outsideAgents = cacheFile(cacheDir, docsRoot, join(repoRoot, "templates/app/AGENTS.md"))
  expect(inside).toBe(join(cacheDir, "src/001-onboarding.json"))
  expect(outsideReadme).toBe(join(cacheDir, "_external/README.json"))
  expect(outsideAgents).toBe(join(cacheDir, "_external/templates/app/AGENTS.json"))
  expect(outsideReadme.startsWith(cacheDir + "/")).toBe(true)
  expect(outsideAgents.startsWith(cacheDir + "/")).toBe(true)
})
