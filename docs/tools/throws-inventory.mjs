// Snapshot the global contracts the native compiler already ships. The
// coverage flags deliberately exclude the remaining detail-81a contracts.
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const require = createRequire(new URL("../../experiments/package.json", import.meta.url))
const ts = require("typescript")
const hash = value => crypto.createHash("sha256").update(value).digest("hex")

// Keep this walk aligned with vibelang.globalKey. A signature nested in
// another callable is not an independently named global.
function globalKey(decl, file) {
  let name
  if (ts.isFunctionDeclaration(decl) || ts.isMethodSignature(decl) || ts.isMethodDeclaration(decl)) {
    name = decl.name?.getText(file)
  } else if (ts.isCallSignatureDeclaration(decl)) {
    name = "()"
  } else if (ts.isConstructSignatureDeclaration(decl)) {
    name = "new()"
  } else if (ts.isFunctionTypeNode(decl) && ts.isPropertySignature(decl.parent)) {
    decl = decl.parent
    name = decl.name.getText(file)
  } else return null
  if (!name) return null
  const parts = []
  for (let node = decl.parent; node; node = node.parent) {
    if (ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node)) {
      parts.unshift(node.name.getText(file))
    } else if (ts.isTypeLiteralNode(node)) {
      if (!ts.isVariableDeclaration(node.parent)) return null
      parts.unshift(node.parent.name.getText(file))
      node = node.parent
    } else if (ts.isSourceFile(node)) break
    else if (!ts.isModuleBlock(node) && !ts.isVariableDeclarationList(node) && !ts.isVariableStatement(node)) return null
  }
  if (name === "()") return parts.join(".") + "()"
  return [...parts, name].join(".")
}

export function buildInventory(repo = root) {
  const tableSource = fs.readFileSync(path.join(repo, "typescript/tsc/internal/vibelang/globalthrows_table.go"), "utf8")
  const contracts = new Map([...tableSource.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map(match => [match[1], match[2]]))
  if (contracts.size < 1000) throw new Error("The compiler's generated global throws table could not be read")
  const libs = path.join(repo, "typescript/tsc/internal/bundled/libs")
  const inputs = {}
  const declarations = new Map()
  for (const filename of fs.readdirSync(libs).filter(name => name.endsWith(".d.ts")).sort()) {
    const text = fs.readFileSync(path.join(libs, filename), "utf8")
    inputs[filename] = hash(text)
    const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    if (file.parseDiagnostics.length) throw new Error("Cannot parse bundled input " + filename)
    function visit(node) {
      const key = globalKey(node, file)
      if (key) {
        // Use source spelling, not printer spelling: the compiler reads the
        // same declaration. Preserve overload distinctions and source inputs.
        const signature = node.getText(file).replace(/\s+/g, " ").trim()
        if (!declarations.has(key)) declarations.set(key, new Map())
        const overloads = declarations.get(key)
        if (!overloads.has(signature)) {
          overloads.set(signature, { own_throws: contracts.get(key) ?? "unknown", sources: [] })
        }
        overloads.get(signature).sources.push(filename)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  const lib = Object.fromEntries([...declarations].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, signatures]) => [
    key,
    Object.fromEntries([...signatures].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([signature, record]) => [
      signature, { ...record, sources: [...new Set(record.sources)].sort() }
    ]))
  ]))
  return {
    schema_version: 1,
    generated_by: "node docs/tools/throws-inventory.mjs --write",
    coverage: {
      global_own_throws: true,
      effect_exports: false,
      rethrows: false,
      callback_admission: false,
      returned_callable_contracts: false
    },
    effect_version: JSON.parse(fs.readFileSync(path.join(repo, "packages/runtime/package.json"), "utf8")).peerDependencies.effect,
    inputs: { typescript_libs: inputs, compiler_global_table_sha256: hash(tableSource), parser_version: ts.version },
    modules: { lib }
  }
}

export function renderInventory(repo = root) {
  return JSON.stringify(buildInventory(repo), null, 2) + "\n"
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.join(root, "docs/design/inventory/throws.json")
  const text = renderInventory()
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, text)
    console.log("Wrote docs/design/inventory/throws.json")
  } else {
    if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== text) {
      console.error("Throws inventory is stale; run node docs/tools/throws-inventory.mjs --write")
      process.exitCode = 1
    }
  }
}
