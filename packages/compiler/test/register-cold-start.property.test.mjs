import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { coldProjects } from "../register-prefill.mjs"

const fc = createRequire(new URL("../../runtime/package.json", import.meta.url))("fast-check")

// A package graph: each package may depend on later ones, hold .vibe files,
// lack a tsconfig, or be an installed dependency rather than workspace source.
const graph = fc.integer({ min: 1, max: 9 }).chain((size) => fc.array(fc.record({
  dependencies: fc.uniqueArray(fc.integer({ min: 0, max: size - 1 }), { maxLength: 4 }),
  vibe: fc.boolean(),
  tsconfig: fc.boolean(),
  installed: fc.boolean()
}), { minLength: size, maxLength: size }))

function build(packages) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cold-graph-")))
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  packages.forEach((info, index) => {
    const directory = info.installed && index !== 0 ? `store/node_modules/p${index}` : `packages/p${index}`
    const dependencies = Object.fromEntries(info.dependencies.filter((other) => other > index).map((other) => [`p${other}`, "1.0.0"]))
    write(`${directory}/package.json`, JSON.stringify({ name: `p${index}`, dependencies }))
    if (info.tsconfig) write(`${directory}/tsconfig.json`, "{}")
    write(`${directory}/src/${info.vibe ? "m.vibe" : "m.ts"}`, "export {}\n")
  })
  packages.forEach((info, index) => {
    const directory = info.installed && index !== 0 ? `store/node_modules/p${index}` : `packages/p${index}`
    mkdirSync(join(root, directory, "node_modules"), { recursive: true })
    for (const other of info.dependencies.filter((value) => value > index)) {
      const target = packages[other].installed ? `store/node_modules/p${other}` : `packages/p${other}`
      symlinkSync(join(root, target), join(root, directory, "node_modules", `p${other}`))
    }
  })
  return root
}

function expected(root, packages) {
  const seen = new Set()
  const visit = (index) => {
    if (seen.has(index) || (packages[index].installed && index !== 0)) return
    seen.add(index)
    packages[index].dependencies.filter((other) => other > index).forEach(visit)
  }
  visit(0)
  return [...seen].filter((index) => packages[index].vibe && packages[index].tsconfig)
    .map((index) => join(root, `packages/p${index}/tsconfig.json`)).sort()
}

test("the prefill compiles exactly the workspace source projects a package reaches", () => {
  fc.assert(fc.property(graph, (packages) => {
    const root = build(packages)
    try {
      assert.deepEqual([...coldProjects([join(root, "packages/p0")])].sort(), expected(root, packages))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { numRuns: 60 })
})
