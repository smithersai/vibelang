import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import fc from "fast-check"
import vibelang from "../src/esbuild.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-absolute-default-reexport.json", import.meta.url)))
const sources = [
  "export default { value: 1 }\n",
  "export default class Shared {}\n",
  "export default Symbol('shared')\n",
  "let count = 0; export default () => ++count\n"
]

async function check({ source, name, extension, depth = 0 }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-esbuild-identity-"))
  try {
    mkdirSync(join(root, "node_modules"), { recursive: true })
    for (const [name, target] of [
      ["vibelang", join(repo, "packages/compiler")],
      ["effect", join(repo, "experiments/node_modules/effect")]
    ]) symlinkSync(target, join(root, "node_modules", name))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", strict: true, skipLibCheck: true, types: [], noEmit: true, allowImportingTsExtensions: true, allowArbitraryExtensions: true },
      include: ["**/*.ts", "**/*.vibe", "**/*.vibex"]
    }))
    const relative = "./" + "nested/".repeat(depth) + name + "." + extension
    const file = join(root, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, source)
    writeFileSync(join(root, "barrel.ts"), 'export { default as Request } from ' + JSON.stringify(relative) + '\n')
    writeFileSync(join(root, "entry.ts"), [
      'import local from ' + JSON.stringify(relative),
      'import absolute from ' + JSON.stringify(file),
      'import { Request } from "./barrel.ts"',
      'console.log(JSON.stringify({ same: local === absolute, barrel: absolute === Request }))'
    ].join("\n"))
    const result = await build({
      absWorkingDir: root, entryPoints: [join(root, "entry.ts")], bundle: true,
      platform: "node", format: "esm", write: false, metafile: true, logLevel: "silent",
      plugins: [vibelang({ root, compiler })]
    })
    const output = join(root, "out.mjs")
    writeFileSync(output, result.outputFiles[0].text)
    const executed = spawnSync(process.execPath, [output], { encoding: "utf8" })
    assert.equal(executed.status, 0, executed.stdout + executed.stderr)
    assert.deepEqual(JSON.parse(executed.stdout), { same: true, barrel: true })
    const inputs = Object.keys(result.metafile.inputs).filter(input => input.endsWith(name + "." + extension))
    assert.equal(inputs.length, 1, JSON.stringify(inputs))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Smithers absolute shared-map imports retain the native barrel's default identity", async () => {
  await check(corpus)
})

test("ordinary TypeScript absolute imports retain their native module identity", async () => {
  await check({ ...corpus, extension: "ts" })
})

test("property: absolute and relative native imports share objects, symbols, classes and closures", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    source: fc.constantFrom(...sources),
    name: fc.constantFrom("program", "with space", "créé", "literal%20", "日本"),
    extension: fc.constantFrom("vibe", "vibex"),
    depth: fc.integer({ min: 0, max: 2 })
  }), check), { seed: 811086, numRuns: 32 })
})
