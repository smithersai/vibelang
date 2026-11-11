import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/cli-deep-declaration-gate.json", import.meta.url)))
const quote = "the same doc comment on each export"

const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
function trees(input, check) {
  const root = mkdtempSync(join(tmpdir(), "migrate-deep-declarations-"))
  try {
    for (const side of ["before", "after"]) {
      put(root, side + "/package.json", JSON.stringify(input.manifest))
      put(root, side + "/" + input.file, input[side])
      if (input.manifest.types || input.manifest.exports) put(root, side + "/index.d.ts", "export {};\n")
    }
    const consumer = join(root, "consumer")
    mkdirSync(join(consumer, "node_modules"), { recursive: true })
    symlinkSync(join(root, "before"), join(consumer, "node_modules/cli"), "dir")
    const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, types: [], noEmit: true }
    const importer = join(consumer, "main.ts")
    const selected = ts.resolveModuleName(input.specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName
    return check({ root, selected, importer, options, before: join(root, "before"), after: join(root, "after") })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

export function check(parts, ext, rootEntry, changed, exports) {
      const file = "dist/" + parts.join("/") + ext
      const manifest = { ...corpus.manifest, ...(rootEntry ? { types: "./index.d.ts" } : {}), ...(exports ? { exports: { ".": "./index.d.ts" } } : {}) }
      const input = { manifest, file, specifier: "cli/" + file.replace(/\.d\.(ts|mts|cts)$/, (_, e) => e === "ts" ? ".js" : e === "mts" ? ".mjs" : ".cjs"), before: corpus.before, after: changed ? corpus.after : corpus.before }
      trees(input, ({ selected, before, after }) => {
        assert.equal(Boolean(selected), !exports)
        const result = compareDeclarations(ts, before, after)
        assert.equal(result.identical, exports || !changed)
        assert.equal(result.publicSurface.before.reachable.includes(file), !exports)
      })

}

export { trees, put }
