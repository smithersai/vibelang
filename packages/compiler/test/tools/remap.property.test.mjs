// remapLocations, over generated modules: every identifier in the syntax tree
// Babel parses from a .vibe module's emitted JavaScript, once remapped, names
// its own text in the .vibe source, however many type-only lines the compile
// erased before it.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { compilerPackage, project } from "./helpers.mjs"

const require = createRequire(import.meta.url)
const babel = require("@babel/core")
const { emitModule, remapLocations } = await import(join(compilerPackage, "emit.mjs"))

// One statement of a module; `i` keeps its names unique.
const statement = fc.oneof(
  fc.constant((i) => `type T${i} = { readonly a: number }`),
  fc.constant((i) => `interface I${i} {\n  readonly b: string\n\n  readonly c?: ReadonlyArray<number> | undefined\n}`),
  fc.integer({ min: 0, max: 99 }).map((n) => (i) => `export const v${i}: number = ${n}`),
  fc.constant((i) => `export function f${i}(x: number, label: string): string {\n  const y: number = x * 2\n  return label + String(y)\n}`),
  fc.constant((i) => `export const g${i} = (items: ReadonlyArray<number>): number =>\n  items.reduce((sum: number, item: number): number => sum + item, 0)`),
  fc.constant(() => "// a comment\n"),
  fc.constant(() => "")
)
const moduleText = fc.array(statement, { minLength: 1, maxLength: 12 })
  .map((parts) => parts.map((part, i) => part(i)).join("\n") + "\nexport const end: string = \"end\"\n")

test("remapped identifiers name their own .vibe text", (t) => {
  const modules = fc.sample(moduleText, { numRuns: 40, seed: 20261101 })
  const files = Object.fromEntries(modules.map((text, i) => [`src/m${i}.vibe`, text]))
  const root = project(t, files)
  let checked = 0
  for (const [path, text] of Object.entries(files)) {
    const output = emitModule(join(root, path))
    const ast = remapLocations(babel.parseSync(output.code, { babelrc: false, configFile: false, sourceType: "module" }), output.map)
    const lines = readFileSync(join(root, path), "utf8").split("\n")
    babel.traverse(ast, {
      Identifier({ node }) {
        const { line, column } = node.loc.start
        assert.equal(lines[line - 1]?.slice(column, column + node.name.length), node.name, `${path}:${line}:${column}\n${text}`)
        checked++
      }
    })
  }
  assert.ok(checked > modules.length)
})
