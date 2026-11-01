// A receipt avoids repeating successful analysis; the artifact and every input
// are still read and hashed on each CLI invocation. Direct test oracles bypass it.
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, sep } from "node:path"

const require = createRequire(import.meta.url)
const digest = data => createHash("sha256").update(data).digest("hex")
const receiptPath = root => join(root, ".cache/throws-inventory.json")

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])
}

export function inventoryInputKey(root) {
  const hash = createHash("sha256").update(JSON.stringify([1, process.platform, process.arch, process.version, process.versions.bun ?? null]))
  const add = (name, file) => hash.update(JSON.stringify([name, digest(readFileSync(file))]))
  for (const file of ["docs/tools/throws-inventory.mjs", "docs/tools/throws-source.mjs", "docs/tools/throws-receipt.mjs",
    "docs/tools/package.json", "packages/runtime/package.json", "typescript/tsc/internal/core/version.go"])
    add(file, join(root, file))
  for (const [label, directory, keep] of [
    ["libs", join(root, "typescript/tsc/internal/bundled/libs"), file => file.endsWith(".d.ts")],
    ["effect", join(root, "docs/tools/node_modules/effect"), file => file === "package.json" || file.startsWith("dist/") && /\.(?:js|ts)$/.test(file)],
    ["parser", dirname(require.resolve("typescript/package.json")), file => /\.(?:js|json|ts)$/.test(file)]
  ]) {
    for (const file of files(directory)) {
      const name = relative(directory, file).split(sep).join("/")
      if (keep(name)) add(label + "/" + name, file)
    }
  }
  return hash.digest("hex")
}

export function readInventoryReceipt(root, key, artifact) {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath(root), "utf8"))
    return receipt.schemaVersion === 1 && receipt.key === key && receipt.artifact === digest(readFileSync(artifact))
  } catch {
    return false // Missing/corrupt receipts and missing artifacts require analysis.
  }
}

export function writeInventoryReceipt(root, key, expected) {
  const path = receiptPath(root)
  const temp = path + "." + randomUUID() + ".tmp"
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temp, JSON.stringify({ schemaVersion: 1, key, artifact: digest(expected) }) + "\n")
    renameSync(temp, path)
  } catch (error) {
    // The receipt is optional. Keep a valid docs result if its cache is unwritable.
    console.error("throws.json: receipt unavailable (" + (error.code ?? "write failed") + ")")
  } finally {
    try { rmSync(temp, { force: true }) } catch {}
  }
}
