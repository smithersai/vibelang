// vibelang/metro over generated module declarations (VIP-40): withVibeLang
// writes a stand-in for every body output the compiler emits, under the
// compiler's own file name, whatever the declaration's name (kept, encoded or
// escaped characters) and however it is spaced. The compiler's emit is the
// oracle. t3code's mobile module with a body replays through Metro itself.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import fc from "fast-check"
import { compilerPackage, project, tools } from "./helpers.mjs"

const require = createRequire(import.meta.url)
const { withVibeLang } = require(join(compilerPackage, "metro.cjs"))
const compiler = process.env.VIBELANG_BINARY
const standIns = (root) => join(root, "node_modules", ".cache", "vibelang-metro")

// rule-evidence: docs/design/src/001-functions.md#module-declarations
const rule = "Body outputs use the source file's full basename, including `.vibe` or `.vibex`, followed by `.` and the encoded module name."

// A name's characters: kept ones, and ones the file name encodes.
const first = fc.constantFrom("a", "q", "z", "T", "M", "$", "_", "Ü", "é", "Ω", "名")
const rest = fc.array(fc.constantFrom("a", "x", "9", "_", "B", "$", "ß", "ü"), { maxLength: 5 })
// Written literally, or as a \u escape of its code point, which names the same binding.
const spelled = (character, escape, braced) => !escape ? character
  : braced ? `\\u{${character.codePointAt(0).toString(16)}}`
  : character.codePointAt(0) > 0xffff ? character : `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`
const declaration = fc.record({
  first, rest,
  escapes: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
  braced: fc.boolean(),
  // What may precede the declaration on its line: the end of a statement or
  // of a comment that began on an earlier line.
  before: fc.constantFrom("", "  ", "export const p = 0; ", "function p() {} ", "/* c\n */ ", "/*\n*/"),
  afterKeyword: fc.constantFrom(" ", "  ", "\t", " /* c */ "),
  beforeBrace: fc.constantFrom(" ", "", "\n", " /* c */ ", " // c\n")
})
const file = fc.record({
  vibex: fc.boolean(),
  declarations: fc.array(declaration, { minLength: 1, maxLength: 4 })
})

// The file's text: each declaration, a digit suffix keeping its name unique
// and clear of Effect's globals, imported for a value so that it emits.
function text({ declarations }) {
  const lines = []
  declarations.forEach((d, i) => {
    const characters = [d.first, ...d.rest, String(i)]
    const name = characters.map((character, at) => spelled(character, d.escapes[at % d.escapes.length], d.braced)).join("")
    const before = d.before.replace(/\bp\b/, `p${i}`)
    lines.push(`${before}module${d.afterKeyword}${name}${d.beforeBrace}{ export const n = ${i} }`)
    lines.push(`import { n as v${i} } from ${name}`)
  })
  lines.push(`export const all: number[] = [${declarations.map((_, i) => `v${i}`).join(", ")}]`, "")
  return lines.join("\n")
}

test("withVibeLang writes a stand-in under the compiler's name for every body it emits", { skip: !compiler && "set VIBELANG_BINARY" }, async (t) => {
  assert.ok(rule.includes("encoded module name"))
  await fc.assert(fc.asyncProperty(file, async (generated) => {
    const name = generated.vibex ? "main.vibex" : "main.vibe"
    const root = project(t, {
      [`src/${name}`]: text(generated),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, jsx: "react-jsx",
        skipLibCheck: true, types: [], rootDir: "src", outDir: "names" }, include: ["src"] })
    }, ["metro-babel-transformer", "metro-transform-worker"])
    const emitted = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr + text(generated))
    const bodies = readdirSync(join(root, "names")).filter((output) => output.startsWith(name + ".") && /\.jsx?$/.test(output))
    assert.equal(bodies.length, generated.declarations.length, text(generated))
    await withVibeLang({ projectRoot: root, resolver: { sourceExts: ["js", "ts"] } })
    for (const body of bodies) {
      assert.ok(existsSync(join(standIns(root), root, "src", body)), `no stand-in for ${body} of\n${text(generated)}`)
    }
  }), { numRuns: 12 })
})

const Metro = require("metro")
const { getDefaultConfig, mergeConfig } = require("metro-config")
const regression = JSON.parse(readFileSync(new URL("./property-regressions/t3code-mobile-module-body.json", import.meta.url), "utf8"))

test(`regression ${regression.key}: Metro bundles a module that imports from its own body`, async (t) => {
  const root = project(t, regression.files, ["metro", "metro-config", "metro-runtime", "metro-transform-worker", "metro-babel-transformer"])
  const config = withVibeLang(mergeConfig(await getDefaultConfig(root), {
    projectRoot: root,
    watchFolders: [root, realpathSync(tools)],
    cacheStores: [],
    resetCache: true,
    maxWorkers: 2,
    reporter: { update() {} },
    transformer: { getTransformOptions: async () => ({ transform: { experimentalImportSupport: true, inlineRequires: false } }) }
  }))
  const { code } = await Metro.runBuild(config, { entry: "./entry-body.js", dev: false, minify: false, platform: "ios" })
  const logged = []
  runInNewContext(code, { console: { log: (message) => logged.push(message) } })
  assert.deepEqual(logged, [regression.logs])
})
