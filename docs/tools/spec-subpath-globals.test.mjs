import assert from "node:assert/strict"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import ts from "typescript"
import { chapter, tools } from "./spec-witness.mjs"

// Loop round 3, OPUS-10: chapter 5 lists the subpath namespaces whose names a
// web platform global also has. The list is computed here from the pinned
// packages, so an Effect or TypeScript bump fails until the chapter follows.
const effectDir = join(tools, "node_modules/effect")

function subpathNamespaces(section) {
  const subpaths = [...section.matchAll(/`effect\/([a-z][a-z-]*)`/g)].map(m => m[1])
  const found = new Map()
  for (const subpath of new Set(subpaths)) {
    const candidates = [`dist/unstable/${subpath}/index.d.ts`, `dist/${subpath}/index.d.ts`].map(p => join(effectDir, p))
    const file = candidates.find(existsSync)
    assert.ok(file, `effect has no index for ${subpath}`)
    for (const m of readFileSync(file, "utf8").matchAll(/export \* as (\w+) from/g)) found.set(m[1], subpath)
  }
  return found
}

function platformNames() {
  const libDir = dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ESNext }))
  const names = new Map()
  const add = (name, meaning) => names.set(name, new Set([...(names.get(name) ?? []), meaning]))
  for (const file of readdirSync(libDir).filter(f => /^lib\.(dom|webworker)[.a-z]*\.d\.ts$/.test(f))) {
    const source = ts.createSourceFile(file, readFileSync(join(libDir, file), "utf8"), ts.ScriptTarget.ESNext, true)
    source.forEachChild(node => {
      if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) add(d.name.getText(), "value")
      else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) add(node.name.text, "type")
      else if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, "value")
      else if (ts.isClassDeclaration(node) && node.name) add(node.name.text, "value")
    })
  }
  return names
}

test("chapter 5 lists every subpath namespace that a web platform global shares", () => {
  const services = chapter("005-services")
  const section = services.split("\n").find(line => line.startsWith("3. **Subpath namespaces are in scope:**"))
  assert.ok(section)
  const inventory = section.slice(0, section.indexOf(" The capitalized `effect/<Module>` subpaths"))
  const namespaces = subpathNamespaces(inventory)
  const platform = platformNames()
  const shared = [...namespaces.keys()].filter(name => platform.has(name)).sort()
  assert.deepEqual(shared, ["Event", "Headers", "KeyFormat", "Response", "Transferable", "Worker"])
  const list = section.slice(section.indexOf("In effect 4.1.0 these are"))
  for (const name of shared) {
    assert.ok(list.includes("`" + name + "` (`effect/" + namespaces.get(name) + "`"), name)
    const typeOnly = !platform.get(name).has("value")
    assert.equal(typeOnly, ["KeyFormat", "Transferable"].includes(name), name)
  }
  assert.ok(list.includes("are DOM types only, so a bare type position keeps the DOM's meaning"))
})
