// A cold dev server's dependency scan, for the dep-scan tests: Vite pre-bundles
// only the bare imports its scan finds, and an import found later, when a module
// is first requested, re-optimizes and reloads the page.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import vibelang from "../src/index.js"
import { scanServer } from "./dev-server.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const compiler = join(here, "../../compiler/bin/vibelang")

// The project an input describes: index.html (or, for entry "ts", entry.ts
// named in optimizeDeps.entries) imports the first of a chain of barrels, which
// ends at value.vibe, holding the input's features.
export const features = {
  schema: "export schema Item { value: string }",
  option: "export const maybe = Option.some(1)",
  predicate: "export const isText = Predicate.isString",
  effect: "export const one = effect { return 1 }",
  duration: "export const second = Duration.seconds(1)"
}
export function scanFiles(input) {
  const files = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", target: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true }, include: ["*.ts", "*.vibe"] }),
    "index.html": '<script type="module" src="/entry.ts"></script>\n',
    "value.vibe": input.features.map((name) => features[name]).join("\n") + "\n"
  }
  const target = (index) => index === input.barrels.length ? "value" : `b${index}`
  const specifier = (index) => {
    const name = target(index)
    if (input.explicit === false) return `./${name}`
    return `./${name}${index === input.barrels.length ? ".vibe" : input.barrels[index] === "vibe" ? ".vibe" : ".js"}`
  }
  files["entry.ts"] = `import * as first from "${specifier(0)}"\nconsole.log(first)\n`
  input.barrels.forEach((kind, index) => {
    const next = specifier(index + 1)
    // A .vibe barrel imports its neighbour without an extension, as vibelang allows.
    files[`b${index}.${kind}`] = `export * from "${kind === "vibe" ? `./${target(index + 1)}` : next}"\n`
  })
  return files
}

const bare = (code) => [...new Set([...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)"([^"]+)"/g)]
  .map((match) => match[1]).filter((specifier) => !/^(?:\.|\/|node:|\0)/.test(specifier)))].sort()

// Scans the project at root from a cold server, then requests every module.
// Returns the bare imports the scan found, those found only on request, and the
// bare imports of each .vibe module's JavaScript.
export async function scanProject(root, input) {
  for (const [file, text] of Object.entries(scanFiles(input))) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  const plugin = vibelang({ compiler })
  const server = await scanServer({
    root, configFile: false, logLevel: "silent", plugins: [plugin],
    optimizeDeps: input.entry === "ts" ? { entries: ["entry.ts"] } : input.entry === "html" ? { entries: ["index.html"] } : {},
    server: { ws: false, watch: null }
  })
  try {
    // Not listening, so the optimizer starts here; init assigns scanProcessing.
    const optimizer = server.environments.client.depsOptimizer
    await optimizer.init()
    await optimizer.scanProcessing
    const known = () => Object.keys({ ...optimizer.metadata.discovered, ...optimizer.metadata.optimized }).sort()
    const scanned = known()
    const emitted = {}
    const files = Object.keys(scanFiles(input)).filter((file) => /\.(?:ts|vibe)$/.test(file))
    for (const file of files) await server.transformRequest("/" + file)
    const context = { addWatchFile() {}, error(error) { throw Object.assign(new Error(error.message || error), error) } }
    for (const file of files.filter((name) => name.endsWith(".vibe"))) {
      emitted[file] = bare((await plugin.transform.call(context, "", join(root, file))).code)
    }
    return { scanned, late: known().filter((dep) => !scanned.includes(dep)), emitted }
  } finally {
    await server.close()
  }
}

export function fixtureRoot() {
  mkdirSync(join(here, ".fixtures"), { recursive: true })
  return mkdtempSync(join(here, ".fixtures/scan-"))
}
