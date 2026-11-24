// The prelude must export every name the projector imports from it and every
// global the native compiler gives a .vibe file (VIP-6, VIP-14). The projector's
// lists live in Go (names.go, effectglobals), so read them as text.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const repo = new URL("../../../", import.meta.url)
const read = path => readFileSync(new URL(path, repo), "utf8")
const ts = createRequire(new URL("docs/tools/package.json", repo))("typescript")

// Named exports (each name with the modules it is re-exported from; a local
// declaration adds undefined) and `export *` sources of a declaration file.
function exportsOf(text) {
  const source = ts.createSourceFile("prelude.d.ts", text, ts.ScriptTarget.ESNext, false)
  const named = new Map(), stars = []
  const add = (name, from) => named.set(name, new Set([...(named.get(name) ?? []), from]))
  const has = node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      const from = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
      if (!node.exportClause) stars.push(from)
      else if (ts.isNamedExports(node.exportClause)) for (const spec of node.exportClause.elements) add(spec.name.text, from)
      else add(node.exportClause.name.text, from)
    } else if (has(node)) {
      if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) add(d.name.text, undefined)
      else if (node.name) add(node.name.text, undefined)
    }
  }
  return { named, stars }
}

const prelude = exportsOf(read("packages/ts-mapper/prelude.d.ts"))
const namesGo = read("typescript/tsc/internal/vibelangmapper/names.go")
const goList = name => {
  const match = new RegExp("const " + name + " = `([^`]*)`").exec(namesGo)
  assert.ok(match, "names.go declares " + name)
  return match[1].split(/\s+/).filter(Boolean)
}
const rootList = (() => {
  const body = /var preludeNames = func\(\) map\[string\]bool \{[\s\S]*?\[\]string\{([\s\S]*?)\n\t\} \{/.exec(namesGo)
  assert.ok(body, "names.go declares preludeNames")
  return [...body[1].matchAll(/`([^`]*)`/g)].flatMap(m => m[1].split(/\s+/).filter(Boolean))
})()

test("prelude.d.ts exports every prelude name the projector imports (names.go)", () => {
  const missing = [...rootList, ...goList("d151List"), ...goList("runtimePreludeList")].filter(name => !prelude.named.has(name))
  assert.deepEqual(missing, [])
})

test("prelude.d.ts and names.go list the same effect root modules", () => {
  const fromEffect = [...prelude.named].filter(([, from]) => from.has("effect")).map(([name]) => name).sort()
  assert.deepEqual(fromEffect, [...rootList].sort())
})

test("every effect root module the prelude exports is an export of the pinned effect", { skip: !existsSync(new URL("docs/tools/node_modules/effect/dist/index.d.ts", repo)) && "docs/tools is not installed" }, () => {
  const index = exportsOf(read("docs/tools/node_modules/effect/dist/index.d.ts"))
  const missing = rootList.filter(name => !index.named.has(name))
  assert.deepEqual(missing, [], "names the pinned effect root does not export")
})

test("prelude.d.ts exports every effect/Effect global of a .vibe file (VIP-6, effectglobals)", () => {
  const exports = [...read("typescript/tsc/internal/effectglobals/exports_generated.go").matchAll(/^\t"([^"]+)",$/gm)].map(m => m[1])
  assert.ok(exports.includes("succeed") && exports.includes("acquireRelease"))
  const star = prelude.stars.includes("effect/Effect")
  const missing = exports.filter(name => !star && !prelude.named.has(name))
  assert.deepEqual(missing, [], "export these from effect/Effect in prelude.d.ts")
})
