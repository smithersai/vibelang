import assert from "node:assert/strict"
import { basename } from "node:path"

const es5 = ["lib.es5.d.ts", "lib.decorators.d.ts", "lib.decorators.legacy.d.ts"]
const es2015 = ["es2015", "es2015.core", "es2015.collection", "es2015.iterable", "es2015.generator",
  "es2015.promise", "es2015.proxy", "es2015.reflect", "es2015.symbol", "es2015.symbol.wellknown"]
const es5Libraries = new Set(es5)
const es2015Libraries = new Set([...es5, ...es2015.map(name => "lib." + name + ".d.ts")])
const exampleLimit = 16

function createFixtureGuard(stockTs, label, allowed, selection) {
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
      { count: 0, examples: [] }, label + " must load only " + selection + " and decorator libraries")
  } }
}

export function createEs5FixtureGuard(stockTs, label) {
  return createFixtureGuard(stockTs, label, es5Libraries, "ES5")
}

export function createEs2015FixtureGuard(stockTs, label) {
  return createFixtureGuard(stockTs, label, es2015Libraries, "ES2015")
}
