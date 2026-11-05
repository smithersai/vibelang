import assert from "node:assert/strict"
import { basename } from "node:path"

const allowed = new Set(["lib.es5.d.ts", "lib.decorators.d.ts", "lib.decorators.legacy.d.ts"])
const exampleLimit = 16

export function createEs5FixtureGuard(stockTs, label) {
  const unexpected = new Set()
  const ts = { ...stockTs, createProgram(...args) {
    const program = stockTs.createProgram(...args)
    const sources = program.getSourceFiles()
    // An absent-only entry batch has no roots, sources or library requirement.
    if (program.getRootFileNames().length === 0 && sources.length === 0) return program
    const libraries = sources.map(source => source.fileName)
      .filter(file => /[/\\]lib\.[^/\\]+\.d\.ts$/.test(file))
      .map(file => basename(file.replaceAll("\\", "/")))
    if (!libraries.includes("lib.es5.d.ts")) unexpected.add("missing lib.es5.d.ts")
    for (const name of libraries) if (!allowed.has(name)) unexpected.add(name)
    return program
  } }
  return { ts, assertLibraries() {
    assert.deepEqual({ count: unexpected.size, examples: [...unexpected].sort().slice(0, exampleLimit) },
      { count: 0, examples: [] }, label + " must load only ES5 and decorator libraries")
  } }
}
