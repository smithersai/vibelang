// A loader record leaves out a map's source text and reads it back from the
// file. It must read what the compiler reads: the compiler's reader removes a
// BOM and decodes UTF-16, so a map's sourcesContent has neither.
import { loaderScope } from "../loader-scope.mjs"
import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compileProjectSync, writeLoaderRecord } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const settle = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120)

const text = 'export const value = "café"\n'
const utf16 = Buffer.from(text, "utf16le")
const encodings = {
  "a UTF-8 BOM": Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, "utf8")]),
  "UTF-16 little-endian": Buffer.concat([Buffer.from([0xFF, 0xFE]), utf16]),
  "UTF-16 big-endian": Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(utf16).swap16()])
}

for (const [name, bytes] of Object.entries(encodings)) {
  test(`a record's map holds the text the compiler read from ${name}`, (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-record-text-")))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, "node_modules"))
    symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true },
      include: ["*.vibe"]
    }))
    const source = join(root, "main.vibe")
    writeFileSync(source, bytes)
    settle()
    const project = join(root, "tsconfig.json")
    assert.equal(writeLoaderRecord({ project, compiler }).modules, 1)
    settle()
    const trace = []
    const recorded = compileProjectSync({ [loaderScope]: true, project, compiler, cache: { directory: join(root, ".cache") }, debug: (line) => trace.push(line) })
    assert.ok(trace.some((line) => line.includes("from its loader record")), trace.join("\n"))
    const fresh = compileProjectSync({ [loaderScope]: true, project, compiler, cache: false })
    assert.deepEqual(fresh.outputs.get(source).map.sourcesContent, [text])
    assert.deepEqual(recorded.outputs.get(source).map.sourcesContent, [text])
  })
}
