// With -b, each project fixes its own files, one project after another in
// the build order: a referenced project before the projects that reference it.
import assert from "node:assert/strict"
import { statSync } from "node:fs"
import { join } from "node:path"
import { project, baseOptions } from "../_tooling-witness.mjs"

const legacy = name => `import type { Effect } from "effect"\nexport type ${name} = Effect.Effect<number>\n`
// Root references list dependents first, so a list-order walk would fix c first.
// c -> b -> a, and d stands alone.
const graph = { c: ["b"], b: ["a"], a: [], d: [] }
const expectedOrder = ["a", "b", "c", "d"]

for (const rootOrder of [["c", "b", "a", "d"], ["d", "c", "a", "b"]]) project(({ dir, put, read, invoke }) => {
  put("tsconfig.json", { files: [], references: rootOrder.map(p => ({ path: "./" + p })) })
  for (const [p, deps] of Object.entries(graph)) {
    // Each project's source imports its dependency's types through the reference.
    const imports = deps.map(d => `import type { R${d} } from "../../${d}/src/main.vibe"\nexport type Use${d} = R${d}\n`).join("")
    put(p + "/src/main.vibe", imports + legacy("R" + p))
    put(p + "/tsconfig.json", {
      compilerOptions: { ...baseOptions(), composite: true, declaration: true, rootDir: "src", outDir: "build", allowImportingTsExtensions: true, emitDeclarationOnly: true },
      include: ["src"], references: deps.map(d => ({ path: "../" + d })),
    })
  }
  const r = invoke("--fix", "-b", "tsconfig.json", "--pretty", "false")
  assert.equal(r.status, 0, r.text)
  const order = [...r.stderr.matchAll(/vibelang --fix: project (\w+)[/\\]tsconfig\.json \((\d+)\/(\d+)\)/g)].map(m => m[1])
  // Each project is announced once, in dependency order.
  assert.deepEqual(order.filter(p => p !== "d"), ["a", "b", "c"], rootOrder + "\n" + r.text)
  assert.deepEqual([...order].sort(), expectedOrder, rootOrder + "\n" + r.text)
  // Every project fixed its own file, and the writes happen in that order.
  for (const p of expectedOrder) assert.match(read(p + "/src/main.vibe"), new RegExp(`R${p} = number!!`), p)
  const written = p => statSync(join(dir, p, "src/main.vibe")).mtimeMs
  assert.ok(written("a") <= written("b") && written("b") <= written("c"), "a, then b, then c")
  // A second run finds nothing to fix.
  const before = expectedOrder.map(p => read(p + "/src/main.vibe"))
  const again = invoke("--fix", "-b", "tsconfig.json", "--pretty", "false")
  assert.equal(again.status, 0, again.text)
  assert.deepEqual(expectedOrder.map(p => read(p + "/src/main.vibe")), before)
})
console.log("with -b each project fixes its own files in build order")
