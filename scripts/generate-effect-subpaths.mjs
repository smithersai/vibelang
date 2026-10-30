import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
if (args.some((arg) => arg !== "--write") || args.length > 1) {
  throw new Error("Usage: node scripts/generate-effect-subpaths.mjs [--write]")
}
const effect = resolve(process.env.EFFECT_NODE_MODULES || resolve(root, "docs/tools/node_modules"), "effect")
const pkg = JSON.parse(readFileSync(resolve(effect, "package.json"), "utf8"))
const pin = JSON.parse(readFileSync(resolve(root, "packages/runtime/package.json"), "utf8")).peerDependencies.effect
if (pkg.version !== pin) throw new Error("Effect " + pkg.version + " does not match runtime pin " + pin)

function modules(index) {
  const text = readFileSync(index, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  return new Map([...text.matchAll(/^export \* as (\w+) from "\.\/(\w+)\.ts";/gm)].map((m) => [m[1], m[2]]))
}
const roots = modules(resolve(effect, "dist/index.d.ts"))
const listed = new Map()
for (const [key, target] of Object.entries(pkg.exports)) {
  if (target === null || key === "." || key === "./package.json" || key.includes("*")) continue
  const subpath = key.slice(2)
  const barrel = "effect/" + subpath
  for (const [name, module] of modules(resolve(effect, "dist", subpath, "index.d.ts"))) {
    const exports = listed.get(name) || []
    exports.push({ barrel, module: barrel + "/" + module })
    listed.set(name, exports)
  }
}
const unique = []
const shared = []
for (const name of [...listed.keys()].sort()) {
  const exports = listed.get(name)
  // VIP-14/detail 55: the root has no priority over a subpath exporter.
  if (roots.has(name)) exports.push({ barrel: "effect", module: "effect/" + roots.get(name) })
  if (exports.length > 1) {
    const packages = exports.map((entry) => entry.barrel).sort()
    shared.push("\t" + JSON.stringify(name) + ": {" + packages.map((value) => JSON.stringify(value)).join(", ") + "},")
  } else {
    unique.push("\t" + JSON.stringify(name) + ": {barrel: " + JSON.stringify(exports[0].barrel) + ", module: " + JSON.stringify(exports[0].module) + "},")
  }
}
function replaceTable(text, name, lines) {
  const start = text.indexOf("var " + name + " = ")
  if (start < 0) throw new Error("Missing table " + name)
  const body = text.indexOf("{\n", start) + 2
  const end = text.indexOf("\n}", body)
  if (body < start || end < body) throw new Error("Malformed table " + name)
  return text.slice(0, body) + lines.join("\n") + text.slice(end)
}
const path = resolve(root, "typescript/tsc/internal/vibelang/effectsubpath.go")
const before = readFileSync(path, "utf8")
let after = replaceTable(before, "effectSubpathNames", unique)
after = replaceTable(after, "effectSubpathShared", shared)
after = after.replace(/generated from effect@[0-9.]+/, "generated from effect@" + pkg.version)
after = execFileSync("gofmt", [], { input: after, encoding: "utf8" })
if (args.includes("--write")) {
  writeFileSync(path, after)
  console.log("effect-subpaths: wrote " + unique.length + " unique and " + shared.length + " ambiguous namespaces")
} else if (after !== before) {
  throw new Error("Effect namespace tables are stale; run node scripts/generate-effect-subpaths.mjs --write")
}
